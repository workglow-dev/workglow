/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult, ElicitRequest, ElicitResult } from "@modelcontextprotocol/sdk/types";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types";
import type { IExecuteContext } from "@workglow/task-graph";
import { Task } from "@workglow/task-graph";
import { resolveHumanConnector, uuid4 } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { afterEach, describe, expect, it } from "vitest";
import { createTaskMcpServer } from "../createTaskMcpServer";
import type { McpHttpServerHandle } from "../McpHttpServer";
import { startMcpHttpServer } from "../McpHttpServer";
import type { AnyTaskConstructor } from "../taskTools";
import { RawStreamableClient } from "./rawStreamableClient";

/** Asks a person for a name, then answers with what they said. */
class AskTask extends Task<Record<string, never>, { answer: string; action: string }> {
  public static override type = "AskTask";
  public static override category = "Utility";

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { answer: { type: "string" }, action: { type: "string" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(
    _input: Record<string, never>,
    context: IExecuteContext
  ): Promise<{ answer: string; action: string }> {
    const response = await resolveHumanConnector(context).send(
      {
        requestId: uuid4(),
        targetHumanId: "default",
        kind: "elicit",
        message: "What is your name?",
        contentSchema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        } as DataPortSchema,
        contentData: undefined,
        expectsResponse: true,
        mode: "single",
        metadata: undefined,
      },
      context.signal
    );
    return {
      answer: String(response.content?.name ?? ""),
      action: response.action,
    };
  }
}

const TASKS = [AskTask] as unknown as AnyTaskConstructor[];

const open = async (elicitation?: boolean): Promise<McpHttpServerHandle> =>
  startMcpHttpServer({
    port: 0,
    host: "127.0.0.1",
    token: undefined,
    createServer: () =>
      createTaskMcpServer({ name: "test", version: "1.0.0", tasks: TASKS, elicitation }),
  });

/** A client that answers elicitation, or one that never advertised it. */
async function connect(
  handle: McpHttpServerHandle,
  onElicit?: (request: ElicitRequest) => ElicitResult
): Promise<Client> {
  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    onElicit ? { capabilities: { elicitation: {} } } : {}
  );
  if (onElicit) client.setRequestHandler(ElicitRequestSchema, onElicit);
  await client.connect(new StreamableHTTPClientTransport(new URL(handle.url)));
  return client;
}

const openResources: Array<{ close: () => Promise<void> }> = [];
const track = <T extends { close: () => Promise<void> }>(value: T): T => {
  openResources.push(value);
  return value;
};

afterEach(async () => {
  for (const resource of openResources.splice(0)) await resource.close();
});

describe("human-in-the-loop over MCP", () => {
  it("asks the calling client and hands the answer back to the task", async () => {
    const handle = track(await open());
    let asked: ElicitRequest | undefined;
    const client = track(
      await connect(handle, (request) => {
        asked = request;
        return { action: "accept", content: { name: "ada" } };
      })
    );

    const result = (await client.callTool({
      name: "AskTask",
      arguments: {},
    })) as CallToolResult;

    expect(asked?.params.message).toBe("What is your name?");
    expect(asked?.params.requestedSchema).toEqual({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    });
    expect(result.structuredContent).toEqual({ answer: "ada", action: "accept" });
  });

  it("carries a decline back rather than treating it as an answer", async () => {
    const handle = track(await open());
    const client = track(await connect(handle, () => ({ action: "decline" })));

    const result = (await client.callTool({
      name: "AskTask",
      arguments: {},
    })) as CallToolResult;
    expect(result.structuredContent).toEqual({ answer: "", action: "decline" });
  });

  it("keeps concurrent calls asking their own client", async () => {
    const handle = track(await open());
    const first = track(
      await connect(handle, () => ({ action: "accept", content: { name: "one" } }))
    );
    const second = track(
      await connect(handle, () => ({ action: "accept", content: { name: "two" } }))
    );

    // The connector is bound per call, so two sessions in flight must not both
    // resolve against whichever one was created last.
    const [a, b] = (await Promise.all([
      first.callTool({ name: "AskTask", arguments: {} }),
      second.callTool({ name: "AskTask", arguments: {} }),
    ])) as CallToolResult[];
    expect(a.structuredContent).toEqual({ answer: "one", action: "accept" });
    expect(b.structuredContent).toEqual({ answer: "two", action: "accept" });
  });

  it("tells a client that cannot be asked, rather than waiting on it", async () => {
    const handle = track(await open());
    const client = track(await connect(handle));

    const result = (await client.callTool({
      name: "AskTask",
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("elicitation");
  });

  it("reaches a client that never opened the standalone stream", async () => {
    // The GET stream is optional in the spec, and the SDK client opens one
    // eagerly — so only a hand-rolled client can show that the elicitation
    // travels on the tool call's own stream rather than leaning on the GET.
    const handle = track(await open());
    const client = new RawStreamableClient(handle.url);
    await client.initialize({ elicitation: {} });

    const result = await client.callTool("AskTask", {}, () => ({
      action: "accept",
      content: { name: "raw" },
    }));
    expect(result.result?.structuredContent).toEqual({ answer: "raw", action: "accept" });
  });

  it("leaves the host's own connector alone when elicitation is off", async () => {
    const handle = track(await open(false));
    const client = track(
      await connect(handle, () => ({ action: "accept", content: { name: "x" } }))
    );

    // Nothing bound HUMAN_CONNECTOR in this process, so the task fails the way
    // it would in any host that never registered one — which is the point: the
    // per-call child is not created, and the host's registry decides.
    const result = (await client.callTool({
      name: "AskTask",
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("HUMAN_CONNECTOR");
  });
});
