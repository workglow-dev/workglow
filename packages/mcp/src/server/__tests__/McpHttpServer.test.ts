/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { IExecuteContext } from "@workglow/task-graph";
import { Task } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createTaskMcpServer } from "../createTaskMcpServer";
import type { McpHttpServerHandle } from "../McpHttpServer";
import { hostWithoutPort, startMcpHttpServer } from "../McpHttpServer";
import type { AnyTaskConstructor } from "../taskTools";

const TOKEN = "test-token-value";

class GreetTask extends Task<{ name: string }, { greeting: string }> {
  public static override type = "GreetTask";
  public static override category = "Utility";
  public static override description = "Says hello";

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { name: { type: "string", default: "world" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { greeting: { type: "string" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(
    input: { name: string },
    _context: IExecuteContext
  ): Promise<{ greeting: string }> {
    if (input.name === "boom") throw new Error("refused to greet");
    return { greeting: `hello ${input.name}` };
  }
}

/** Reports progress forwards, then backwards, then forwards again. */
class StepTask extends Task<Record<string, never>, { done: boolean }> {
  public static override type = "StepTask";
  public static override category = "Utility";

  override async execute(
    _input: Record<string, never>,
    context: IExecuteContext
  ): Promise<{ done: boolean }> {
    await context.updateProgress(50, "half");
    await context.updateProgress(20, "backwards");
    await context.updateProgress(undefined, "indeterminate");
    await context.updateProgress(90, "nearly");
    return { done: true };
  }
}

const TASKS = [GreetTask, StepTask] as unknown as AnyTaskConstructor[];

const open = async (
  token: string | undefined,
  maxBodyBytes?: number
): Promise<McpHttpServerHandle> =>
  startMcpHttpServer({
    port: 0,
    host: "127.0.0.1",
    token,
    maxBodyBytes,
    createServer: () => createTaskMcpServer({ name: "test", version: "1.0.0", tasks: TASKS }),
  });

async function connect(handle: McpHttpServerHandle, token: string | undefined): Promise<Client> {
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(handle.url), {
      requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
    })
  );
  return client;
}

interface RawResponse {
  readonly status: number;
  readonly headers: NodeJS.Dict<string | string[]>;
  readonly body: string;
}

/**
 * A POST built by hand, because `fetch` will not send some of what this server
 * is checking: `Host` is a forbidden header name there, so a rebinding attempt
 * expressed through `fetch` arrives with the real host and proves nothing.
 */
function rawPost(url: string, headers: Record<string, string>, body = ""): Promise<RawResponse> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: "POST",
        headers,
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (text += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text })
        );
      }
    );
    req.on("error", reject);
    req.end(body);
  });
}

const openResources: Array<{ close: () => Promise<void> }> = [];
const track = <T extends { close: () => Promise<void> }>(value: T): T => {
  openResources.push(value);
  return value;
};

afterEach(async () => {
  for (const resource of openResources.splice(0)) await resource.close();
});

describe("hostWithoutPort", () => {
  it("strips the port", () => {
    expect(hostWithoutPort("127.0.0.1:8788")).toBe("127.0.0.1");
    expect(hostWithoutPort("localhost")).toBe("localhost");
  });

  it("keeps a bracketed IPv6 literal whole", () => {
    // Splitting on the first colon yields "[", which matches no allow-list and
    // refuses every request from http://[::1]:8788/.
    expect(hostWithoutPort("[::1]:8788")).toBe("[::1]");
  });
});

describe("startMcpHttpServer, authenticated", () => {
  it("refuses a request with no bearer token", async () => {
    const handle = track(await open(TOKEN));
    const response = await rawPost(handle.url, {});
    expect(response.status).toBe(401);
    expect(response.headers["www-authenticate"]).toContain("Bearer");
    expect(JSON.parse(response.body)).toMatchObject({
      error: { message: "missing bearer token" },
    });
  });

  it("refuses a request with the wrong bearer token", async () => {
    const handle = track(await open(TOKEN));
    const response = await rawPost(handle.url, { Authorization: "Bearer nope" });
    expect(response.status).toBe(401);
    expect(JSON.parse(response.body)).toMatchObject({
      error: { message: "invalid bearer token" },
    });
  });

  it("refuses a Host header it was not bound to, whatever token it carries", async () => {
    const handle = track(await open(TOKEN));
    const response = await rawPost(handle.url, {
      Authorization: `Bearer ${TOKEN}`,
      Host: "attacker.example",
    });
    expect(response.status).toBe(403);
  });

  it("answers nothing outside its endpoint path", async () => {
    const handle = track(await open(TOKEN));
    const response = await rawPost(`${new URL(handle.url).origin}/elsewhere`, {
      Authorization: `Bearer ${TOKEN}`,
    });
    expect(response.status).toBe(404);
  });

  it("refuses a body it will not buffer", async () => {
    const handle = track(await open(TOKEN, 64));
    const response = await rawPost(
      handle.url,
      { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      JSON.stringify({ padding: "x".repeat(500) })
    );
    expect(response.status).toBe(413);
  });

  it("names a malformed body as a parse error rather than hanging the socket", async () => {
    const handle = track(await open(TOKEN));
    const response = await rawPost(
      handle.url,
      { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      "{not json"
    );
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe(-32700);
  });

  it("keeps a server-side failure's detail off the wire", async () => {
    // An unexpected throw here carries whatever the thrower put in it, and
    // this endpoint answers anyone who reaches the port.
    const handle = track(
      await startMcpHttpServer({
        port: 0,
        host: "127.0.0.1",
        token: TOKEN,
        createServer: () => {
          throw new Error("connect ECONNREFUSED /var/secrets/db.sock");
        },
      })
    );
    const response = await rawPost(
      handle.url,
      { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "x", version: "1" },
        },
      })
    );
    expect(response.status).toBe(500);
    expect(response.body).not.toContain("/var/secrets");
    expect(JSON.parse(response.body).error.message).toBe("internal server error");
  });

  it("serves the registered tasks as tools once a client authenticates", async () => {
    const handle = track(await open(TOKEN));
    const client = track(await connect(handle, TOKEN));

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["GreetTask", "StepTask"]);
    expect(tools[0]).toMatchObject({
      name: "GreetTask",
      description: "[Utility] Says hello",
      inputSchema: { type: "object", properties: { name: { type: "string", default: "world" } } },
    });
  });

  it("runs the task behind a tool and returns its output", async () => {
    const handle = track(await open(TOKEN));
    const client = track(await connect(handle, TOKEN));

    const result = (await client.callTool({
      name: "GreetTask",
      arguments: { name: "ada" },
    })) as CallToolResult;
    expect(result.structuredContent).toEqual({ greeting: "hello ada" });
    expect(result.content).toEqual([{ type: "text", text: '{\n  "greeting": "hello ada"\n}' }]);
    expect(result.isError).toBeFalsy();
  });

  it("reports a failed task as a tool error, not a dead connection", async () => {
    const handle = track(await open(TOKEN));
    const client = track(await connect(handle, TOKEN));

    const result = (await client.callTool({
      name: "GreetTask",
      arguments: { name: "boom" },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("refused to greet");

    // The session survives it: one bad call does not end the conversation.
    const after = (await client.callTool({
      name: "GreetTask",
      arguments: { name: "ada" },
    })) as CallToolResult;
    expect(after.structuredContent).toEqual({ greeting: "hello ada" });
  });

  it("rejects an unknown tool as a protocol error", async () => {
    const handle = track(await open(TOKEN));
    const client = track(await connect(handle, TOKEN));

    await expect(client.callTool({ name: "NoSuchTask", arguments: {} })).rejects.toThrow(
      /unknown tool/
    );
  });

  it("forwards task progress, and only where it moved forward", async () => {
    const handle = track(await open(TOKEN));
    const client = track(await connect(handle, TOKEN));

    const seen: Array<{ progress: number; message?: string }> = [];
    await client.callTool({ name: "StepTask", arguments: {} }, undefined, {
      onprogress: (progress) => {
        seen.push({ progress: progress.progress, message: progress.message });
      },
    });

    // MCP requires the value to increase on every notification, so the
    // backwards step and the indeterminate one are dropped rather than
    // reshaped into a number nothing measured. The trailing 100 is the
    // runner's own, on the task landing.
    expect(seen).toEqual([
      { progress: 50, message: "half" },
      { progress: 90, message: "nearly" },
      { progress: 100, message: undefined },
    ]);
  });

  it("keeps each client in its own session", async () => {
    const handle = track(await open(TOKEN));
    track(await connect(handle, TOKEN));
    expect(handle.sessionCount()).toBe(1);
    track(await connect(handle, TOKEN));
    expect(handle.sessionCount()).toBe(2);
  });
});

describe("startMcpHttpServer, bound to a wildcard", () => {
  it("does not refuse the clients the wildcard exists to admit", async () => {
    // Nothing about `0.0.0.0` names the addresses this machine answers on, so
    // deriving an allow-list from it refused every client of the exposure the
    // operator asked for — including the one the startup banner points at.
    const handle = track(
      await startMcpHttpServer({
        port: 0,
        host: "0.0.0.0",
        token: undefined,
        createServer: () => createTaskMcpServer({ name: "test", version: "1.0.0", tasks: TASKS }),
      })
    );
    const response = await rawPost(
      `http://127.0.0.1:${new URL(handle.url).port}${new URL(handle.url).pathname}`,
      { Host: "192.168.1.10", "content-type": "application/json" },
      "{}"
    );
    expect(response.status).not.toBe(403);
  });

  it("still checks the Host when one is named explicitly", async () => {
    const handle = track(
      await startMcpHttpServer({
        port: 0,
        host: "0.0.0.0",
        token: undefined,
        allowedHosts: ["mcp.internal"],
        createServer: () => createTaskMcpServer({ name: "test", version: "1.0.0", tasks: TASKS }),
      })
    );
    const response = await rawPost(
      `http://127.0.0.1:${new URL(handle.url).port}${new URL(handle.url).pathname}`,
      { Host: "192.168.1.10", "content-type": "application/json" },
      "{}"
    );
    expect(response.status).toBe(403);
  });
});

describe("startMcpHttpServer, unauthenticated", () => {
  it("serves without a token when the host turned authentication off", async () => {
    const handle = track(await open(undefined));
    expect(handle.token).toBeUndefined();
    const client = track(await connect(handle, undefined));

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["GreetTask", "StepTask"]);
  });
});
