/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { BrowserSessionManager, RunCleanupRegistry } from "@workglow/browser-automation";
import type {
  BrowserSessionState,
  IBrowserBackendAdapter,
  IBrowserRuntimeSession,
} from "@workglow/browser-automation";

// ========================================================================
// Mock adapter and session
// ========================================================================

class MockRuntimeSession implements IBrowserRuntimeSession {
  readonly backend = "playwright";
  closed = false;
  navigateCalls: string[] = [];

  async close() {
    this.closed = true;
  }
  async navigate(url: string) {
    this.navigateCalls.push(url);
    return { url, title: "Mock Title" };
  }
  async click() {}
  async type() {}
  async extract() {
    return null;
  }
  async wait() {}
  async screenshot() {
    return { mime: "image/png" as const, bytes: new Uint8Array([]) };
  }
  async evaluate() {
    return null;
  }
}

class MockAdapter implements IBrowserBackendAdapter {
  sessions: MockRuntimeSession[] = [];

  async createSession(): Promise<IBrowserRuntimeSession> {
    const session = new MockRuntimeSession();
    this.sessions.push(session);
    return session;
  }
}

class SlowMockAdapter implements IBrowserBackendAdapter {
  sessions: MockRuntimeSession[] = [];

  async createSession(): Promise<IBrowserRuntimeSession> {
    await Promise.resolve(); // yield to allow concurrent callers to queue up
    const session = new MockRuntimeSession();
    this.sessions.push(session);
    return session;
  }
}

function makeSessionState(id: string = "test-session"): BrowserSessionState {
  return {
    id,
    backend: "playwright",
    createdAt: new Date().toISOString(),
    config: { headless: true },
  };
}

describe("BrowserSessionManager", () => {
  it("creates a session via the adapter", async () => {
    const cleanup = new RunCleanupRegistry();
    const adapter = new MockAdapter();
    const manager = new BrowserSessionManager({ playwright: adapter }, cleanup);

    const state = makeSessionState();
    await manager.getOrCreate(state);

    expect(manager.hasSession(state.id)).toBe(true);
    expect(manager.size).toBe(1);
    expect(adapter.sessions.length).toBe(1);
  });

  it("getOrCreate is idempotent", async () => {
    const cleanup = new RunCleanupRegistry();
    const adapter = new MockAdapter();
    const manager = new BrowserSessionManager({ playwright: adapter }, cleanup);

    const state = makeSessionState();
    await manager.getOrCreate(state);
    await manager.getOrCreate(state);

    // Should not create a second session
    expect(adapter.sessions.length).toBe(1);
  });

  it("runExclusive executes against the session runtime", async () => {
    const cleanup = new RunCleanupRegistry();
    const adapter = new MockAdapter();
    const manager = new BrowserSessionManager({ playwright: adapter }, cleanup);

    const state = makeSessionState();
    await manager.getOrCreate(state);

    await manager.runExclusive(state.id, async (runtime) => {
      await runtime.navigate("https://example.com", { timeoutMs: 5000, waitUntil: "load" });
    });

    expect(adapter.sessions[0].navigateCalls).toEqual(["https://example.com"]);
  });

  it("runExclusive throws for unknown session", async () => {
    const cleanup = new RunCleanupRegistry();
    const manager = new BrowserSessionManager({}, cleanup);

    await expect(manager.runExclusive("nonexistent", async () => {})).rejects.toThrow("not found");
  });

  it("closeSession closes and removes session", async () => {
    const cleanup = new RunCleanupRegistry();
    const adapter = new MockAdapter();
    const manager = new BrowserSessionManager({ playwright: adapter }, cleanup);

    const state = makeSessionState();
    await manager.getOrCreate(state);
    const closed = await manager.closeSession(state.id);

    expect(closed).toBe(true);
    expect(manager.hasSession(state.id)).toBe(false);
    expect(adapter.sessions[0].closed).toBe(true);
  });

  it("closeSession is idempotent", async () => {
    const cleanup = new RunCleanupRegistry();
    const adapter = new MockAdapter();
    const manager = new BrowserSessionManager({ playwright: adapter }, cleanup);

    const state = makeSessionState();
    await manager.getOrCreate(state);
    await manager.closeSession(state.id);
    const closedAgain = await manager.closeSession(state.id);

    expect(closedAgain).toBe(false);
  });

  it("closeAll closes all sessions", async () => {
    const cleanup = new RunCleanupRegistry();
    const adapter = new MockAdapter();
    const manager = new BrowserSessionManager({ playwright: adapter }, cleanup);

    await manager.getOrCreate(makeSessionState("s1"));
    await manager.getOrCreate(makeSessionState("s2"));
    expect(manager.size).toBe(2);

    await manager.closeAll();
    expect(manager.size).toBe(0);
    expect(adapter.sessions.every((s) => s.closed)).toBe(true);
  });

  it("registers cleanup handler that closes all sessions", async () => {
    const cleanup = new RunCleanupRegistry();
    const adapter = new MockAdapter();
    const manager = new BrowserSessionManager({ playwright: adapter }, cleanup);

    await manager.getOrCreate(makeSessionState("s1"));
    await manager.getOrCreate(makeSessionState("s2"));

    // Simulates run completion
    await cleanup.runAll();

    expect(manager.size).toBe(0);
    expect(adapter.sessions.every((s) => s.closed)).toBe(true);
  });

  it("throws when no adapter for requested backend", async () => {
    const cleanup = new RunCleanupRegistry();
    const manager = new BrowserSessionManager({}, cleanup);

    await expect(manager.getOrCreate(makeSessionState())).rejects.toThrow("No backend adapter");
  });

  it("concurrent getOrCreate for same session ID creates only one session", async () => {
    const cleanup = new RunCleanupRegistry();
    const adapter = new SlowMockAdapter();
    const manager = new BrowserSessionManager({ playwright: adapter }, cleanup);
    const state = makeSessionState();

    await Promise.all([
      manager.getOrCreate(state),
      manager.getOrCreate(state),
      manager.getOrCreate(state),
    ]);

    expect(adapter.sessions.length).toBe(1);
    expect(manager.size).toBe(1);
  });

  it("closeAll waits for in-flight creations before closing", async () => {
    const cleanup = new RunCleanupRegistry();
    const adapter = new SlowMockAdapter();
    const manager = new BrowserSessionManager({ playwright: adapter }, cleanup);
    const state = makeSessionState();

    const creation = manager.getOrCreate(state); // start but don't await
    await Promise.all([creation, manager.closeAll()]);

    expect(adapter.sessions.length).toBe(1);
    expect(adapter.sessions[0].closed).toBe(true);
    expect(manager.size).toBe(0);
  });

  it("concurrent getOrCreate all reject when adapter throws", async () => {
    const cleanup = new RunCleanupRegistry();
    let callCount = 0;
    const failingAdapter: IBrowserBackendAdapter = {
      async createSession() {
        callCount++;
        await Promise.resolve();
        throw new Error("adapter failure");
      },
    };
    const manager = new BrowserSessionManager({ playwright: failingAdapter }, cleanup);
    const state = makeSessionState();

    const results = await Promise.allSettled([
      manager.getOrCreate(state),
      manager.getOrCreate(state),
      manager.getOrCreate(state),
    ]);

    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(callCount).toBe(1); // adapter called only once despite three concurrent callers
    expect(manager.size).toBe(0);
  });

  it("serializes operations on same session via mutex", async () => {
    const cleanup = new RunCleanupRegistry();
    const adapter = new MockAdapter();
    const manager = new BrowserSessionManager({ playwright: adapter }, cleanup);

    const state = makeSessionState();
    await manager.getOrCreate(state);

    let running = 0;
    let maxConcurrent = 0;

    const op = async () => {
      await manager.runExclusive(state.id, async () => {
        running++;
        maxConcurrent = Math.max(maxConcurrent, running);
        await new Promise((r) => setTimeout(r, 10));
        running--;
      });
    };

    await Promise.all([op(), op(), op()]);
    expect(maxConcurrent).toBe(1);
  });
});
