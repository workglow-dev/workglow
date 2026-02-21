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

const extractKinds = ["text", "html", "attr", "property", "count", "exists", "list"] as const;
const listKinds = ["text", "html", "attr", "property"] as const;

const inputSchema = {
  type: "object",
  properties: {
    context: { type: "object", additionalProperties: true, default: {} },
    session_id: { type: "string" },
    timeout_ms: { type: "number", minimum: 1, default: 30000 },
    selector: { type: "string", minLength: 1 },
    kind: { type: "string", enum: extractKinds },
    attr_name: { type: "string", minLength: 1 },
    property_name: { type: "string", minLength: 1 },
    list_kind: { type: "string", enum: listKinds, default: "text" },
  },
  required: ["selector", "kind"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    context: { type: "object", additionalProperties: true },
    data: {},
  },
  required: ["context", "data"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserExtractTaskInput = FromSchema<typeof inputSchema> &
  BrowserTaskInputCommon &
  Record<string, unknown>;
export type BrowserExtractTaskOutput = FromSchema<typeof outputSchema>;

function ensureExtractInput(input: BrowserExtractTaskInput): void {
  if (input.kind === "attr" && !input.attr_name) {
    throw new TaskConfigurationError("kind=attr requires attr_name");
  }
  if (input.kind === "property" && !input.property_name) {
    throw new TaskConfigurationError("kind=property requires property_name");
  }
  if (input.kind === "list" && (input.list_kind === "attr" || input.list_kind === "property")) {
    if (input.list_kind === "attr" && !input.attr_name) {
      throw new TaskConfigurationError("kind=list with list_kind=attr requires attr_name");
    }
    if (input.list_kind === "property" && !input.property_name) {
      throw new TaskConfigurationError("kind=list with list_kind=property requires property_name");
    }
  }
}

export class BrowserExtractTask extends Task<
  BrowserExtractTaskInput,
  BrowserExtractTaskOutput,
  TaskConfig
> {
  public static readonly type = "BrowserExtractTask";
  public static readonly category = "Browser";
  public static readonly title = "Browser Extract";
  public static readonly description = "Extracts data from the current page using selector-based strategies";
  public static readonly cacheable = false;

  public static inputSchema() {
    return inputSchema;
  }

  public static outputSchema() {
    return outputSchema;
  }

  public async execute(input: BrowserExtractTaskInput, executeContext: IExecuteContext) {
    ensureExtractInput(input);
    const manager = getBrowserSessionManagerFromContext(executeContext);
    const sessionId = resolveSessionId(input, true)!;

    return await manager.runExclusive(sessionId, async () => {
      const session = manager.getSessionOrThrow(sessionId);
      const timeout = input.timeout_ms ?? 30000;
      const locator = session.page.locator(input.selector);
      let data: unknown;

      switch (input.kind) {
        case "text":
          await session.page.waitForSelector(input.selector, { timeout });
          data = await locator.first().textContent({ timeout });
          break;
        case "html":
          await session.page.waitForSelector(input.selector, { timeout });
          data = await locator.first().innerHTML({ timeout });
          break;
        case "attr":
          await session.page.waitForSelector(input.selector, { timeout });
          data = await locator.first().getAttribute(input.attr_name!, { timeout });
          break;
        case "property":
          await session.page.waitForSelector(input.selector, { timeout });
          data = await locator
            .first()
            .evaluate((el: any, propertyName: string) => el?.[propertyName], input.property_name);
          break;
        case "count":
          data = await locator.count();
          break;
        case "exists":
          data = (await locator.count()) > 0;
          break;
        case "list": {
          const listKind = input.list_kind ?? "text";
          if (listKind === "text") {
            data = await locator.allTextContents();
          } else if (listKind === "html") {
            data = await locator.evaluateAll((elements: any[]) =>
              elements.map((el) => el?.innerHTML ?? "")
            );
          } else if (listKind === "attr") {
            const attrName = input.attr_name!;
            data = await locator.evaluateAll(
              (elements: any[], name: string) => elements.map((el) => el?.getAttribute?.(name)),
              attrName
            );
          } else {
            const propertyName = input.property_name!;
            data = await locator.evaluateAll(
              (elements: any[], name: string) => elements.map((el) => el?.[name]),
              propertyName
            );
          }
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
        data,
      };
    });
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    browserExtract: CreateWorkflow<BrowserExtractTaskInput, BrowserExtractTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.browserExtract = CreateWorkflow(BrowserExtractTask);
