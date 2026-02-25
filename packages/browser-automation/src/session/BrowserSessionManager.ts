/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserBackendName, BrowserSessionState } from "../core/context";
import type { IBrowserBackendAdapter, IBrowserRuntimeSession } from "../core/types";
import { FifoMutex } from "./FifoMutex";
import type { RunCleanupRegistry } from "./RunCleanupRegistry";

interface SessionEntry {
  lock: FifoMutex;
  runtime: IBrowserRuntimeSession;
  lastUsedAt: number;
}

export interface BrowserSessionManagerOpts {
  idleTtlMs?: number;
}

/**
 * Run-scoped browser session manager.
 *
 * - Sessions are keyed by `session.id` (string).
 * - Per-session operations are serialized via a FIFO mutex.
 * - Different sessions can run concurrently.
 * - Registers a cleanup handler to close all sessions on run completion.
 */
export class BrowserSessionManager {
  private sessions = new Map<string, SessionEntry>();
  private adapters: Partial<Record<BrowserBackendName, IBrowserBackendAdapter>>;
  private idleTtlMs: number;

  constructor(
    adapters: Partial<Record<BrowserBackendName, IBrowserBackendAdapter>>,
    cleanup: RunCleanupRegistry,
    opts?: BrowserSessionManagerOpts
  ) {
    this.adapters = adapters;
    this.idleTtlMs = opts?.idleTtlMs ?? 120_000;
    cleanup.add("browserAutomation.sessionManager.closeAll", () => this.closeAll());
  }

  /**
   * Get or create a runtime session for the given session state.
   * Idempotent: if the session already exists, this is a no-op.
   */
  async getOrCreate(session: BrowserSessionState): Promise<void> {
    if (this.sessions.has(session.id)) return;

    const adapter = this.adapters[session.backend];
    if (!adapter) {
      throw new Error(
        `No backend adapter registered for "${session.backend}". ` +
          `Available: ${Object.keys(this.adapters).join(", ") || "none"}`
      );
    }

    const runtime = await adapter.createSession(session);
    this.sessions.set(session.id, {
      lock: new FifoMutex(),
      runtime,
      lastUsedAt: Date.now(),
    });
  }

  /**
   * Run a function exclusively against a session's runtime.
   * The session must have been created via `getOrCreate` first.
   */
  async runExclusive<T>(
    sessionId: string,
    fn: (runtime: IBrowserRuntimeSession) => Promise<T>
  ): Promise<T> {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      throw new Error(`Browser session "${sessionId}" not found. Call getOrCreate first.`);
    }
    return entry.lock.runExclusive(async () => {
      entry.lastUsedAt = Date.now();
      return fn(entry.runtime);
    });
  }

  /**
   * Close a specific session. Idempotent.
   */
  async closeSession(sessionId: string): Promise<boolean> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return false;

    await entry.lock.runExclusive(async () => {
      this.sessions.delete(sessionId);
      await entry.runtime.close();
    });
    return true;
  }

  /**
   * Close all sessions. Used by the cleanup registry.
   */
  async closeAll(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    await Promise.allSettled(ids.map((id) => this.closeSession(id)));
  }

  /**
   * Check if a session exists.
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Number of active sessions.
   */
  get size(): number {
    return this.sessions.size;
  }

  /**
   * Idle TTL in milliseconds.
   */
  get idleTtl(): number {
    return this.idleTtlMs;
  }
}
