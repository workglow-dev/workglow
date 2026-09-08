/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Server as McpServerInstance } from "@modelcontextprotocol/sdk/server";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { authorizeBearer } from "./bearerAuth";
import { McpSessionRouter } from "./McpSessionRouter";

/** Where a client posts unless the host says otherwise. */
export const DEFAULT_MCP_PATH = "/mcp";

/**
 * Refuse a request body larger than this.
 *
 * Generous next to a console form, because a tool call legitimately carries
 * the document it is being asked about — but still bounded, since the body is
 * buffered whole before the transport sees it.
 */
const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface StartMcpHttpServerArgs {
  readonly port: number;
  readonly host: string;
  /** Path the MCP endpoint answers on. Defaults to {@link DEFAULT_MCP_PATH}. */
  readonly path?: string;
  /**
   * Bearer token every request must present.
   *
   * `undefined` serves without authentication — a deliberate choice for a host
   * that has its own gate in front, never a default worth falling into.
   */
  readonly token?: string | undefined;
  /** One MCP server instance per client session. */
  readonly createServer: () => McpServerInstance;
  /**
   * Extra `Host` header values to answer to, beyond the bound host and the
   * loopback names. Needed when clients reach this server by a name that is
   * not what it was bound to.
   */
  readonly allowedHosts?: Iterable<string>;
  readonly maxBodyBytes?: number;
}

export interface McpHttpServerHandle {
  readonly server: HttpServer;
  /** The full endpoint URL, path included — what goes into a client config. */
  readonly url: string;
  readonly token: string | undefined;
  readonly sessionCount: () => number;
  readonly close: () => Promise<void>;
}

interface RequestContext {
  readonly path: string;
  readonly token: string | undefined;
  readonly allowedHosts: ReadonlySet<string>;
  readonly maxBodyBytes: number;
  readonly router: McpSessionRouter<StreamableHTTPServerTransport>;
}

/**
 * The host a `Host:` header names, without its port.
 *
 * An IPv6 literal is bracketed and full of colons, so splitting on the first
 * one yields `"["` — which matches no allow-list, and refuses every request
 * from `http://[::1]:8788/` while naming a host nobody typed.
 */
export function hostWithoutPort(header: string | undefined): string {
  const value = (header ?? "").trim();
  if (value.startsWith("[")) {
    const close = value.indexOf("]");
    return close === -1 ? value.toLowerCase() : value.slice(0, close + 1).toLowerCase();
  }
  const colon = value.indexOf(":");
  return (colon === -1 ? value : value.slice(0, colon)).toLowerCase();
}

/** A JSON-RPC error body, which is what an MCP client can actually read. */
function sendError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string,
  headers: Record<string, string> = {}
): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

async function readBody(req: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) throw new Error("request body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function serve(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RequestContext
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== ctx.path) {
    sendError(res, 404, -32601, `no MCP endpoint at "${url.pathname}"`);
    return;
  }

  // The Host check stops DNS rebinding turning a page on another site into a
  // local client of this server. It runs before the token check because a
  // rebound request is refused whether or not it guessed a token.
  const host = hostWithoutPort(req.headers.host);
  if (host && !ctx.allowedHosts.has(host)) {
    sendError(res, 403, -32000, `refusing requests for host "${host}"`);
    return;
  }

  const denied = authorizeBearer(req.headers.authorization, ctx.token);
  if (denied) {
    sendError(res, denied.status, -32001, denied.error, {
      "www-authenticate": denied.wwwAuthenticate,
    });
    return;
  }

  const sessionId = req.headers["mcp-session-id"];
  const existing = ctx.router.get(typeof sessionId === "string" ? sessionId : undefined);

  if (req.method !== "POST") {
    // GET opens the session's notification stream and DELETE ends it; both
    // address a session that initialize already created.
    if (!existing) {
      sendError(res, 400, -32000, "missing or unknown session id");
      return;
    }
    await existing.handleRequest(req, res);
    return;
  }

  // The body is read and parsed here rather than inside the transport because
  // the decision it drives — is this an initialize, and so may it open a
  // session — has to be made before there is a transport to hand it to.
  let body: string;
  try {
    body = await readBody(req, ctx.maxBodyBytes);
  } catch (error) {
    sendError(res, 413, -32000, error instanceof Error ? error.message : "request body too large");
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    sendError(res, 400, -32700, error instanceof Error ? error.message : "malformed request body");
    return;
  }

  if (existing) {
    await existing.handleRequest(req, res, parsed);
    return;
  }
  if (!isInitializeRequest(parsed)) {
    sendError(res, 400, -32000, "missing or unknown session id");
    return;
  }
  const transport = await ctx.router.open();
  await transport.handleRequest(req, res, parsed);
}

/**
 * Serves MCP over Streamable HTTP from `node:http`.
 *
 * `node:http` rather than `Bun.serve` or a framework, so one implementation
 * serves Bun and Node alike and a host takes on no web framework to run it.
 * A host that already has one — Hono, Express — should mount
 * {@link McpSessionRouter} on its own routes instead of starting this.
 */
export async function startMcpHttpServer(
  args: StartMcpHttpServerArgs
): Promise<McpHttpServerHandle> {
  const path = args.path ?? DEFAULT_MCP_PATH;
  const router = new McpSessionRouter({
    createTransport: (hooks) => new StreamableHTTPServerTransport(hooks),
    createServer: args.createServer,
  });
  const ctx: RequestContext = {
    path,
    token: args.token,
    allowedHosts: new Set([
      args.host.toLowerCase(),
      "localhost",
      "127.0.0.1",
      "[::1]",
      "::1",
      ...[...(args.allowedHosts ?? [])].map((value) => value.toLowerCase()),
    ]),
    maxBodyBytes: args.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    router,
  };

  const server = createHttpServer((req, res) => {
    serve(req, res, ctx).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) sendError(res, 500, -32603, message);
      else res.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(args.port, args.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : args.port;
  // A bare wildcard is not something a client config can connect to.
  const displayHost = args.host === "0.0.0.0" || args.host === "::" ? "localhost" : args.host;
  return {
    server,
    url: `http://${displayHost}:${port}${path}`,
    token: args.token,
    sessionCount: () => router.size,
    close: async () => {
      await router.closeAll();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
