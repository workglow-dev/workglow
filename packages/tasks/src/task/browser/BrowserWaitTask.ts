/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreateWorkflow,
  IExecuteContext,
  Task,
  TaskConfig,
  TaskConfigurationError,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";
import { getBrowserSessionManagerFromContext } from "./BrowserSessionManager";
import {
  BrowserTaskInputCommon,
  cloneContext,
  resolveSessionId,
  setBrowserMetadata,
} from "./types";

const waitModes = ["timeout", "selector", "url", "load_state", "function"] as const;

const inputSchema = {
  type: "object",
  properties: {
    context: { type: "object", additionalProperties: true, default: {} },
    session_id: { type: "string" },
    timeout_ms: { type: "number", minimum: 1, default: 30000 },
    mode: { type: "string", enum: waitModes },
    selector: { type: "string", minLength: 1 },
    selector_state: { type: "string", enum: ["attached", "detached", "visible", "hidden"] },
    url: { type: "string", minLength: 1 },
    load_state: { type: "string", enum: ["load", "domcontentloaded", "networkidle"] },
    function_code: { type: "string", minLength: 1 },
    function_args: {},
  },
  required: ["mode"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    context: { type: "object", additionalProperties: true },
    waited: { type: "boolean" },
  },
  required: ["context", "waited"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserWaitTaskInput = FromSchema<typeof inputSchema> &
  BrowserTaskInputCommon &
  Record<string, unknown>;
export type BrowserWaitTaskOutput = FromSchema<typeof outputSchema>;

function ensureModeInput(input: BrowserWaitTaskInput): void {
  switch (input.mode) {
    case "timeout":
      return;
    case "selector":
      if (!input.selector) {
        throw new TaskConfigurationError("mode=selector requires selector");
      }
      return;
    case "url":
      if (!input.url) {
        throw new TaskConfigurationError("mode=url requires url");
      }
      return;
    case "load_state":
      if (!input.load_state) {
        throw new TaskConfigurationError("mode=load_state requires load_state");
      }
      return;
    case "function":
      if (!input.function_code) {
        throw new TaskConfigurationError("mode=function requires function_code");
      }
      return;
  }
}

export class BrowserWaitTask extends Task<BrowserWaitTaskInput, BrowserWaitTaskOutput, TaskConfig> {
  public static readonly type = "BrowserWaitTask";
  public static readonly category = "Browser";
  public static readonly title = "Browser Wait";
  public static readonly description = "Waits for timeout, selector, URL, load state, or custom function";
  public static readonly cacheable = false;

  public static inputSchema() {
    return inputSchema;
  }

  public static outputSchema() {
    return outputSchema;
  }

  public async execute(input: BrowserWaitTaskInput, executeContext: IExecuteContext) {
    ensureModeInput(input);
    const manager = getBrowserSessionManagerFromContext(executeContext);
    const sessionId = resolveSessionId(input, true)!;

    return await manager.runExclusive(sessionId, async () => {
      const session = manager.getSessionOrThrow(sessionId);
      const timeout = input.timeout_ms ?? 30000;

      switch (input.mode) {
        case "timeout":
          await session.page.waitForTimeout(timeout);
          break;
        case "selector":
          await session.page.waitForSelector(input.selector!, {
            state: input.selector_state ?? "visible",
            timeout,
          });
          break;
        case "url":
          await session.page.waitForURL(input.url!, { timeout });
          break;
        case "load_state":
          await session.page.waitForLoadState(input.load_state!, { timeout });
          break;
        case "function": {
          const fn = new Function(
            "payload",
            `"use strict"; const { args, context } = payload; ${input.function_code}`
          ) as (payload: unknown) => unknown;
          await session.page.waitForFunction(
            fn,
            { args: input.function_args, context: cloneContext(input.context) },
            { timeout }
          );
          break;
        }
      }

      const currentUrl = session.page.url?.() ?? "";
      let title = "";
      try {
        title = (await session.page.title?.()) ?? "";
      } catch {
        title = "";
      }

      const context = setBrowserMetadata(cloneContext(input.context), {
        session_id: sessionId,
        url: currentUrl,
        title,
      });

      return {
        context,
        waited: true,
      };
    });
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    browserWait: CreateWorkflow<BrowserWaitTaskInput, BrowserWaitTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.browserWait = CreateWorkflow(BrowserWaitTask);
