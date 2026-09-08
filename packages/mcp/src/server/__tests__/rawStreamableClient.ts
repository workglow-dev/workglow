/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types";

/**
 * A Streamable HTTP client written by hand, for the one thing the SDK's cannot
 * express: never opening the standalone GET stream.
 *
 * The SDK client opens one the moment `notifications/initialized` is accepted,
 * so a test built on it cannot tell a server that routes its requests onto a
 * tool call's own stream from one that leans on the GET stream being there.
 * The spec makes that GET optional, so a real client is free to behave like
 * this one.
 */
export class RawStreamableClient {
  private sessionId: string | undefined;
  private nextId = 1;

  /**
   * Every server notification that arrived on a call's own stream, raw.
   *
   * A notification carries a method and no id, so it is not a request to answer
   * and not the result to return — without somewhere to put it, a client like
   * this one cannot tell "delivered here" from "sent to the GET stream nobody
   * opened", which is exactly the distinction these tests exist to make.
   */
  readonly seenNotifications: string[] = [];

  constructor(private readonly url: string) {}

  /** Initializes the session, declaring whatever capabilities were asked for. */
  async initialize(capabilities: Record<string, unknown> = {}): Promise<void> {
    const response = await this.post({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "initialize",
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities,
        clientInfo: { name: "raw-client", version: "1.0.0" },
      },
    });
    this.sessionId = response.headers.get("mcp-session-id") ?? undefined;
    await response.body?.cancel();
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }).then((res) =>
      res.body?.cancel()
    );
  }

  /**
   * Calls a tool, answering any server request that arrives on the call's own
   * stream with `answer`, and resolves with the tool result.
   *
   * Reading and replying on the same stream is the whole point: nothing here
   * ever issues a GET, so a server request that went anywhere else would leave
   * this hanging until the test times out.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    answer?: (request: JsonRpcMessage) => unknown
  ): Promise<JsonRpcMessage> {
    const id = this.nextId++;
    const response = await this.post({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    });
    if (!response.body) throw new Error(`tool call returned no body (status ${response.status})`);

    for await (const message of readSseMessages(response.body)) {
      if (message.method !== undefined && message.id === undefined) {
        this.seenNotifications.push(JSON.stringify(message));
        continue;
      }
      if (message.method !== undefined && message.id !== undefined) {
        if (!answer) throw new Error(`unanswered server request: ${message.method}`);
        // Replies go out as their own POST, the way a client must answer a
        // server-initiated request over this transport.
        await this.post({ jsonrpc: "2.0", id: message.id, result: answer(message) }).then((res) =>
          res.body?.cancel()
        );
        continue;
      }
      if (message.id === id) return message;
    }
    throw new Error("stream ended before the tool result arrived");
  }

  private post(body: unknown): Promise<Response> {
    return fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
      },
      body: JSON.stringify(body),
    });
  }
}

export interface JsonRpcMessage {
  readonly id?: string | number;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly message: string };
}

/** The `data:` payloads of an SSE stream, parsed, in arrival order. */
async function* readSseMessages(body: ReadableStream<Uint8Array>): AsyncGenerator<JsonRpcMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let split = buffer.indexOf("\n\n");
    for (; split !== -1; split = buffer.indexOf("\n\n")) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (data) yield JSON.parse(data) as JsonRpcMessage;
    }
  }
}
