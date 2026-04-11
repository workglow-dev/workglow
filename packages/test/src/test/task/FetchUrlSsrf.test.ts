/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * SSRF protection tests for FetchUrlTask — covers the URL classifier, the
 * SafeFetch DI boundary, dynamic entitlements, and end-to-end enforcement
 * through the graph runner.
 */

import { PermanentJobError } from "@workglow/job-queue";
import {
  createPolicyEnforcer,
  createProfilePolicy,
  ENTITLEMENT_ENFORCER,
  Entitlements,
  TaskEntitlementError,
  TaskGraph,
  TaskGraphRunner,
  TaskRegistry,
  type IEntitlementEnforcer,
} from "@workglow/task-graph";
import {
  classifyUrl,
  FetchUrlTask,
  registerSafeFetch,
  safeFetch,
  type SafeFetchFn,
  urlResourcePattern,
} from "@workglow/tasks";
import { Container, ServiceRegistry, setLogger } from "@workglow/util";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

const ok = (): Response =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

describe("URL classifier", () => {
  test("classifies canonical IPv4 loopback as private", () => {
    expect(classifyUrl("http://127.0.0.1/").kind).toBe("private");
    expect(classifyUrl("http://127.0.0.1:3000/api").kind).toBe("private");
  });

  test("classifies RFC1918 private IPv4 as private", () => {
    expect(classifyUrl("http://10.0.0.5/").kind).toBe("private");
    expect(classifyUrl("http://172.16.0.1/").kind).toBe("private");
    expect(classifyUrl("http://192.168.1.1/").kind).toBe("private");
  });

  test("classifies link-local metadata IP (169.254.169.254) as private", () => {
    const c = classifyUrl("http://169.254.169.254/");
    expect(c.kind).toBe("private");
    expect(c.reason).toContain("linkLocal");
  });

  test("classifies IPv4 in decimal form (inet_aton) as private", () => {
    // 2130706433 === 0x7f000001 === 127.0.0.1
    const c = classifyUrl("http://2130706433/");
    expect(c.kind).toBe("private");
    expect(c.literalIp).toBe("127.0.0.1");
  });

  test("classifies IPv4 in hex form as private", () => {
    const c = classifyUrl("http://0x7f000001/");
    expect(c.kind).toBe("private");
    expect(c.literalIp).toBe("127.0.0.1");
  });

  test("classifies IPv4 in octal form as private", () => {
    // 0177.0.0.1 — 0177 octal = 127
    const c = classifyUrl("http://0177.0.0.1/");
    expect(c.kind).toBe("private");
    expect(c.literalIp).toBe("127.0.0.1");
  });

  test("classifies IPv4 in 2-part form as private", () => {
    // 127.1 packs the tail into 24 low bits → 127.0.0.1
    const c = classifyUrl("http://127.1/");
    expect(c.kind).toBe("private");
    expect(c.literalIp).toBe("127.0.0.1");
  });

  test("classifies IPv6 loopback as private", () => {
    expect(classifyUrl("http://[::1]/").kind).toBe("private");
  });

  test("classifies IPv6 link-local and unique-local as private", () => {
    expect(classifyUrl("http://[fe80::1]/").kind).toBe("private");
    expect(classifyUrl("http://[fc00::1]/").kind).toBe("private");
  });

  test("classifies IPv4-mapped IPv6 as private (defeats the ::ffff bypass)", () => {
    const c = classifyUrl("http://[::ffff:127.0.0.1]/");
    expect(c.kind).toBe("private");
  });

  test("classifies public IPv4 as public", () => {
    expect(classifyUrl("http://8.8.8.8/").kind).toBe("public");
    expect(classifyUrl("https://1.1.1.1/").kind).toBe("public");
  });

  test("classifies public hostnames as public", () => {
    expect(classifyUrl("https://example.com/").kind).toBe("public");
    expect(classifyUrl("https://api.github.com/repos").kind).toBe("public");
  });

  test("classifies well-known private hostnames as private", () => {
    expect(classifyUrl("http://localhost/").kind).toBe("private");
    expect(classifyUrl("http://LOCALHOST/").kind).toBe("private");
    expect(classifyUrl("http://metadata.google.internal/").kind).toBe("private");
  });

  test("normalizes trailing dots (defeats the metadata.google.internal. bypass)", () => {
    expect(classifyUrl("http://metadata.google.internal./").kind).toBe("private");
    expect(classifyUrl("http://localhost./").kind).toBe("private");
  });

  test("classifies .local (mDNS) and .internal suffixes as private", () => {
    expect(classifyUrl("http://printer.local/").kind).toBe("private");
    expect(classifyUrl("http://bar.internal/").kind).toBe("private");
    expect(classifyUrl("http://api.home.arpa/").kind).toBe("private");
  });

  test("classifies file://, ftp://, etc. as invalid", () => {
    expect(classifyUrl("file:///etc/passwd").kind).toBe("invalid");
    expect(classifyUrl("ftp://example.com/").kind).toBe("invalid");
    expect(classifyUrl("gopher://example.com/").kind).toBe("invalid");
  });

  test("rejects URLs with embedded credentials", () => {
    const c = classifyUrl("http://user:pass@example.com/");
    expect(c.kind).toBe("invalid");
    expect(c.reason).toContain("credentials");
  });

  test("rejects malformed URLs", () => {
    expect(classifyUrl("").kind).toBe("invalid");
    expect(classifyUrl("not a url").kind).toBe("invalid");
    expect(classifyUrl("http://").kind).toBe("invalid");
  });
});

describe("urlResourcePattern", () => {
  test("includes port when present", () => {
    expect(urlResourcePattern("http://localhost:3000/api")).toBe("http://localhost:3000/*");
  });

  test("omits port when absent", () => {
    expect(urlResourcePattern("https://example.com/path")).toBe("https://example.com/*");
  });

  test("handles bracketed IPv6 authority", () => {
    expect(urlResourcePattern("http://[::1]:8080/x")).toBe("http://[::1]:8080/*");
  });
});

describe("SafeFetch (registration layer)", () => {
  // A classifier-driven stub impl that mirrors the default browser behaviour:
  // reject invalid + private-without-allowPrivate, otherwise return a stub OK.
  const classifyingStub: SafeFetchFn = (url, options) => {
    const c = classifyUrl(url);
    if (c.kind === "invalid") {
      return Promise.reject(new PermanentJobError(`invalid: ${c.reason}`));
    }
    if (c.kind === "private" && !options.allowPrivate) {
      return Promise.reject(new PermanentJobError(`private: ${c.reason}`));
    }
    return Promise.resolve(ok());
  };

  let prevSafeFetch: SafeFetchFn;

  beforeAll(() => {
    prevSafeFetch = registerSafeFetch(classifyingStub);
  });

  afterAll(() => {
    registerSafeFetch(prevSafeFetch);
  });

  test("rejects invalid URLs", async () => {
    await expect(safeFetch("file:///etc/passwd", {})).rejects.toThrow(/invalid/);
  });

  test("rejects private URLs when allowPrivate is false", async () => {
    await expect(safeFetch("http://127.0.0.1/", {})).rejects.toThrow(/private/);
  });

  test("allows private URLs when allowPrivate is true", async () => {
    const response = await safeFetch("http://127.0.0.1/", { allowPrivate: true });
    expect(response.status).toBe(200);
  });

  test("allows public URLs unconditionally", async () => {
    const response = await safeFetch("https://example.com/", {});
    expect(response.status).toBe(200);
  });
});

describe("FetchUrlTask dynamic entitlements", () => {
  test("declares only network:http for public URLs", () => {
    const task = new FetchUrlTask();
    task.setInput({ url: "https://example.com/" });
    const result = task.entitlements();
    const ids = result.entitlements.map((e) => e.id);
    expect(ids).toContain(Entitlements.NETWORK_HTTP);
    expect(ids).not.toContain(Entitlements.NETWORK_PRIVATE);
  });

  test("adds network:private for loopback URLs, scoped to the URL origin", () => {
    const task = new FetchUrlTask();
    task.setInput({ url: "http://localhost:3000/api" });
    const result = task.entitlements();
    const privateEnt = result.entitlements.find((e) => e.id === Entitlements.NETWORK_PRIVATE);
    expect(privateEnt).toBeDefined();
    expect(privateEnt?.resources).toEqual(["http://localhost:3000/*"]);
  });

  test("adds network:private for RFC1918 IPs", () => {
    const task = new FetchUrlTask();
    task.setInput({ url: "http://192.168.1.1/admin" });
    const result = task.entitlements();
    const ids = result.entitlements.map((e) => e.id);
    expect(ids).toContain(Entitlements.NETWORK_PRIVATE);
  });

  test("adds network:private for cloud metadata IP", () => {
    const task = new FetchUrlTask();
    task.setInput({ url: "http://169.254.169.254/" });
    const result = task.entitlements();
    const ids = result.entitlements.map((e) => e.id);
    expect(ids).toContain(Entitlements.NETWORK_PRIVATE);
  });

  test("requires network:private when URL input is missing (fail-closed)", () => {
    const task = new FetchUrlTask();
    const result = task.entitlements();
    const ids = result.entitlements.map((e) => e.id);
    expect(ids).toContain(Entitlements.NETWORK_HTTP);
    // Fail-closed: require network:private when URL is not yet known at entitlement
    // evaluation time, so a policy grant is needed before any private access can happen.
    expect(ids).toContain(Entitlements.NETWORK_PRIVATE);
  });
});

describe("FetchUrlTask end-to-end entitlement enforcement", () => {
  const logger = getTestingLogger();
  setLogger(logger);

  let prevSafeFetch: SafeFetchFn;

  beforeAll(() => {
    // Stub safeFetch to always return success — we're testing the enforcer,
    // not the network layer.
    prevSafeFetch = registerSafeFetch(() => Promise.resolve(ok()));
    TaskRegistry.registerTask(FetchUrlTask);
  });

  afterAll(() => {
    registerSafeFetch(prevSafeFetch);
  });

  function makeRegistry(enforcer: IEntitlementEnforcer): ServiceRegistry {
    const registry = new ServiceRegistry(new Container());
    registry.register(ENTITLEMENT_ENFORCER, () => enforcer);
    return registry;
  }

  function makeGraphForUrl(url: string): TaskGraph {
    const graph = new TaskGraph();
    graph.addTask(new FetchUrlTask({ id: "fetch-node", queue: false, defaults: { url } }));
    return graph;
  }

  test("browser profile denies private URL (network:private not granted)", async () => {
    const enforcer = createPolicyEnforcer(createProfilePolicy("browser"));
    const registry = makeRegistry(enforcer);
    const runner = new TaskGraphRunner(makeGraphForUrl("http://localhost:3000/api"));
    await expect(runner.runGraph({}, { registry, enforceEntitlements: true })).rejects.toThrow(
      TaskEntitlementError
    );
  });

  test("browser profile allows public URL", async () => {
    const enforcer = createPolicyEnforcer(createProfilePolicy("browser"));
    const registry = makeRegistry(enforcer);
    const runner = new TaskGraphRunner(makeGraphForUrl("https://example.com/"));
    await expect(
      runner.runGraph({}, { registry, enforceEntitlements: true })
    ).resolves.toBeDefined();
  });

  test("dev-augmented browser profile allows loopback-scoped network:private", async () => {
    const browserPolicy = createProfilePolicy("browser");
    const devEnforcer = createPolicyEnforcer({
      deny: browserPolicy.deny,
      grant: [
        ...browserPolicy.grant,
        {
          id: Entitlements.NETWORK_PRIVATE,
          resources: [
            "http://localhost/*",
            "http://localhost:*",
            "http://127.0.0.1/*",
            "http://127.0.0.1:*",
          ],
        },
      ],
      ask: browserPolicy.ask,
    });
    const registry = makeRegistry(devEnforcer);
    const runner = new TaskGraphRunner(makeGraphForUrl("http://localhost:3000/api"));
    await expect(
      runner.runGraph({}, { registry, enforceEntitlements: true })
    ).resolves.toBeDefined();
  });

  test("dev grant scoped to localhost does NOT cover LAN (192.168.x)", async () => {
    const browserPolicy = createProfilePolicy("browser");
    const devEnforcer = createPolicyEnforcer({
      deny: browserPolicy.deny,
      grant: [
        ...browserPolicy.grant,
        {
          id: Entitlements.NETWORK_PRIVATE,
          resources: ["http://localhost/*", "http://localhost:*", "http://127.0.0.1/*"],
        },
      ],
      ask: browserPolicy.ask,
    });
    const registry = makeRegistry(devEnforcer);
    const runner = new TaskGraphRunner(makeGraphForUrl("http://192.168.1.1/admin"));
    await expect(runner.runGraph({}, { registry, enforceEntitlements: true })).rejects.toThrow(
      TaskEntitlementError
    );
  });

  test("WORKGLOW_ALLOW_PRIVATE_URLS env var has no effect (bypass removed)", async () => {
    const previous = process.env.WORKGLOW_ALLOW_PRIVATE_URLS;
    process.env.WORKGLOW_ALLOW_PRIVATE_URLS = "true";
    try {
      const enforcer = createPolicyEnforcer(createProfilePolicy("browser"));
      const registry = makeRegistry(enforcer);
      const runner = new TaskGraphRunner(makeGraphForUrl("http://127.0.0.1/"));
      await expect(runner.runGraph({}, { registry, enforceEntitlements: true })).rejects.toThrow(
        TaskEntitlementError
      );
    } finally {
      if (previous === undefined) delete process.env.WORKGLOW_ALLOW_PRIVATE_URLS;
      else process.env.WORKGLOW_ALLOW_PRIVATE_URLS = previous;
    }
  });
});
