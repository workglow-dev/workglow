/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreateWorkflow,
  Task,
  TaskAbortedError,
  TaskConfig,
  TaskConfigSchema,
  TaskConfigurationError,
  Workflow,
  type IExecuteContext,
} from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { createServiceToken, uuid4 } from "@workglow/util";

// ========================================================================
// Human connector types
// ========================================================================

/**
 * A request sent to a human via an IHumanConnector.
 * Describes WHO to ask, WHAT to show (via JSON schema), and HOW the interaction works.
 */
export interface IHumanRequest {
  /** Unique identifier for this request (used to correlate follow-ups) */
  readonly requestId: string;
  /** Target human identifier — "default" for the main user, or a specific user/role ID */
  readonly targetHumanId: string;
  /** JSON schema describing the form/UI to render for the human */
  readonly schema: DataPortSchema;
  /** Display title for the request */
  readonly title: string | undefined;
  /** Explanatory message shown to the human */
  readonly message: string | undefined;
  /** Interaction mode: single request-response or multi-turn conversation */
  readonly mode: "single" | "multi-turn";
  /** Arbitrary context data passed through to the connector (e.g. for routing, display hints) */
  readonly metadata: Record<string, unknown> | undefined;
}

/**
 * A response from a human, collected by the IHumanConnector.
 */
export interface IHumanResponse {
  /** Correlates to the IHumanRequest.requestId */
  readonly requestId: string;
  /** The human's response data, conforming to the request schema */
  readonly data: Record<string, unknown>;
  /** Whether the conversation is complete. Always true for "single" mode. */
  readonly done: boolean;
}

/**
 * Interface for reaching a human and collecting input.
 *
 * The library defines this contract; UI layers (React, CLI, Slack, etc.) provide
 * concrete implementations and register them via ServiceRegistry.
 */
export interface IHumanConnector {
  /**
   * Send a request to a human and wait for their response.
   * Must respect the AbortSignal for cancellation (e.g. dismiss UI on abort).
   */
  request(request: IHumanRequest, signal: AbortSignal): Promise<IHumanResponse>;

  /**
   * Send a follow-up in a multi-turn conversation.
   * Only called when mode is "multi-turn" and the previous response had done=false.
   * Connectors that only support single mode need not implement this.
   */
  followUp?(
    request: IHumanRequest,
    previousResponse: IHumanResponse,
    signal: AbortSignal
  ): Promise<IHumanResponse>;
}

/** Service token for resolving the IHumanConnector from ServiceRegistry */
export const HUMAN_CONNECTOR = createServiceToken<IHumanConnector>("HUMAN_CONNECTOR");

// ========================================================================
// Task config and schemas
// ========================================================================

const humanInputTaskConfigSchema = {
  type: "object",
  properties: {
    ...TaskConfigSchema["properties"],
    targetHumanId: {
      type: "string",
      title: "Target Human",
      description: "Identifier of the human to ask (e.g. 'default', 'admin', 'user:alice')",
      default: "default",
    },
    schema: {
      type: "object",
      properties: {},
      additionalProperties: true,
      title: "Response Schema",
      description: "JSON schema describing the UI to present to the human",
      "x-ui-hidden": true,
    },
    title: {
      type: "string",
      title: "Title",
      description: "Display title for the human interaction",
    },
    message: {
      type: "string",
      title: "Message",
      description: "Explanatory message shown to the human",
      "x-ui-editor": "textarea",
    },
    mode: {
      type: "string",
      title: "Mode",
      description: "Interaction mode",
      enum: ["single", "multi-turn"],
      default: "single",
    },
    metadata: {
      type: "object",
      additionalProperties: true,
      "x-ui-hidden": true,
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type HumanInputTaskConfig = TaskConfig & {
  /** Target human identifier — defaults to "default" */
  targetHumanId?: string;
  /** JSON schema describing the UI/form to render */
  schema?: DataPortSchema;
  /** Display title */
  title?: string;
  /** Explanatory message */
  message?: string;
  /** Interaction mode — defaults to "single" */
  mode?: "single" | "multi-turn";
  /** Arbitrary metadata passed to the connector */
  metadata?: Record<string, unknown>;
};

const defaultInputSchema = {
  type: "object",
  properties: {
    prompt: {
      type: "string",
      title: "Prompt",
      description: "Dynamic prompt text merged into the request message",
    },
    context: {
      type: "object",
      additionalProperties: true,
      title: "Context",
      description: "Dynamic context data merged into the request metadata",
      "x-ui-hidden": true,
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

const defaultOutputSchema = {
  type: "object",
  properties: {},
  additionalProperties: true,
} as const satisfies DataPortSchema;

export type HumanInputTaskInput = {
  prompt?: string;
  context?: Record<string, unknown>;
};

export type HumanInputTaskOutput = Record<string, unknown>;

// ========================================================================
// HumanInputTask
// ========================================================================

/**
 * A task that pauses graph execution to request input from a human.
 *
 * Sends a JSON schema describing the desired UI to an IHumanConnector,
 * waits for the human's response, and returns it as task output.
 *
 * Supports two modes:
 * - "single": One request, one response (default)
 * - "multi-turn": Iterative conversation until the human signals done
 */
export class HumanInputTask extends Task<
  HumanInputTaskInput,
  HumanInputTaskOutput,
  HumanInputTaskConfig
> {
  static override readonly type = "HumanInputTask";
  static override readonly category = "Flow Control";
  public static override title = "Human Input";
  public static override description =
    "Pauses execution to collect input from a human via a UI described by JSON schema";
  static override readonly cacheable = false;
  public static override hasDynamicSchemas = true;

  public static override configSchema(): DataPortSchema {
    return humanInputTaskConfigSchema;
  }

  static override inputSchema(): DataPortSchema {
    return defaultInputSchema;
  }

  static override outputSchema(): DataPortSchema {
    return defaultOutputSchema;
  }

  public override outputSchema(): DataPortSchema {
    return this.config?.schema ?? (this.constructor as typeof HumanInputTask).outputSchema();
  }

  override async execute(
    input: HumanInputTaskInput,
    context: IExecuteContext
  ): Promise<HumanInputTaskOutput> {
    const connector = this.resolveConnector(context);
    const mode = this.config.mode ?? "single";
    const requestId = uuid4();

    const request: IHumanRequest = {
      requestId,
      targetHumanId: this.config.targetHumanId ?? "default",
      schema: this.config.schema ?? defaultOutputSchema,
      title: this.config.title,
      message: input.prompt
        ? this.config.message
          ? `${this.config.message}\n\n${input.prompt}`
          : input.prompt
        : this.config.message,
      mode,
      metadata: input.context
        ? { ...this.config.metadata, ...input.context }
        : this.config.metadata,
    };

    if (context.signal.aborted) {
      throw new TaskAbortedError("Task aborted before requesting human input");
    }

    let response = await connector.request(request, context.signal);

    if (mode === "multi-turn" && !response.done) {
      if (typeof connector.followUp !== "function") {
        throw new TaskConfigurationError(
          'HumanInputTask is configured for "multi-turn" mode but the registered ' +
            "IHumanConnector does not implement followUp()"
        );
      }

      while (!response.done) {
        if (context.signal.aborted) {
          throw new TaskAbortedError("Task aborted during multi-turn conversation");
        }
        response = await connector.followUp(request, response, context.signal);
      }
    }

    return response.data;
  }

  private resolveConnector(context: IExecuteContext): IHumanConnector {
    return resolveHumanConnector(context);
  }
}

/**
 * Resolves the IHumanConnector from the execution context's ServiceRegistry.
 * Shared by HumanInputTask and HumanApprovalTask.
 */
export function resolveHumanConnector(context: IExecuteContext): IHumanConnector {
  if (!context.registry.has(HUMAN_CONNECTOR)) {
    throw new TaskConfigurationError(
      "No IHumanConnector registered. Register one via " +
        "registry.registerInstance(HUMAN_CONNECTOR, connector) before running a human-in-the-loop task."
    );
  }
  return context.registry.get(HUMAN_CONNECTOR);
}

declare module "@workglow/task-graph" {
  interface Workflow {
    humanInput: CreateWorkflow<HumanInputTaskInput, HumanInputTaskOutput, HumanInputTaskConfig>;
  }
}

Workflow.prototype.humanInput = CreateWorkflow(HumanInputTask);
