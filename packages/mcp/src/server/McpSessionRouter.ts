/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Server } from "@modelcontextprotocol/sdk/server";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { randomUUID } from "node:crypto";

/** A transport that carries an MCP session id once a client has initialized. */
export type McpSessionTransport = Transport & { readonly sessionId?: string | undefined };

/**
 * The session bookkeeping a transport must be constructed with.
 *
 * The router cannot build the transport itself — the Streamable HTTP transport
 * comes in a `node:http` flavour and a `Request`/`Response` one, and which of
 * those a host wants is the whole difference between serving from `node:http`
 * and serving from Hono. So the host builds it, and the router supplies the
 * three options that let it keep track of what was built.
 */
export interface McpSessionHooks {
  readonly sessionIdGenerator: () => string;
  readonly onsessioninitialized: (sessionId: string) => void;
  readonly onsessionclosed: (sessionId: string) => void;
}

export interface McpSessionRouterOptions<T extends McpSessionTransport> {
  readonly createTransport: (hooks: McpSessionHooks) => T;
  /** Called once per session: each client gets its own MCP server instance. */
  readonly createServer: () => Server;
  readonly generateSessionId?: () => string;
}

/**
 * The session half of hosting MCP over HTTP, kept away from any one HTTP stack.
 *
 * Streamable HTTP is not one request/response pair: a client initializes,
 * gets a session id back, and then addresses that session for every later
 * POST, GET (its notification stream) and DELETE. Something has to hold the
 * transports in between, retire them when the client leaves, and close what is
 * still open at shutdown — and that something is identical whether the requests
 * arrive as `IncomingMessage` or as `Request`.
 */
export class McpSessionRouter<T extends McpSessionTransport> {
  private readonly sessions = new Map<string, T>();
  private readonly live = new Set<T>();

  constructor(private readonly options: McpSessionRouterOptions<T>) {}

  /** The transport for an established session, or `undefined` if there is none. */
  get(sessionId: string | undefined): T | undefined {
    return sessionId === undefined ? undefined : this.sessions.get(sessionId);
  }

  /** How many sessions are established right now. */
  get size(): number {
    return this.sessions.size;
  }

  /**
   * A transport for a client that is initializing, already connected to its own
   * server and ready to be handed the request that opened it.
   */
  async open(): Promise<T> {
    const generateSessionId = this.options.generateSessionId ?? randomUUID;
    const transport = this.options.createTransport({
      sessionIdGenerator: generateSessionId,
      onsessioninitialized: (sessionId) => {
        this.sessions.set(sessionId, transport);
      },
      onsessionclosed: (sessionId) => {
        this.sessions.delete(sessionId);
      },
    });
    this.live.add(transport);

    const server = this.options.createServer();
    // The server's own close is the one signal that fires for every way a
    // session can end — a DELETE, a dropped connection, the transport erroring
    // out. `transport.onclose` is not available to hook: `connect` claims it.
    server.onclose = () => {
      this.live.delete(transport);
      const sessionId = transport.sessionId;
      if (sessionId !== undefined && this.sessions.get(sessionId) === transport) {
        this.sessions.delete(sessionId);
      }
    };
    await server.connect(transport);
    return transport;
  }

  /** Closes every open session. Safe to call twice. */
  async closeAll(): Promise<void> {
    const transports = [...this.live];
    this.live.clear();
    this.sessions.clear();
    await Promise.all(
      transports.map(async (transport) => {
        try {
          await transport.close();
        } catch {
          // A transport whose socket is already gone throws on close, which is
          // not a reason for shutdown to reject and leave the rest open.
        }
      })
    );
  }
}
