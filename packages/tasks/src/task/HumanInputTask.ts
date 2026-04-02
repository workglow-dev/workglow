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
// Human connector types — aligned with MCP elicitation semantics
// ========================================================================

/** User action in response to an elicitation, matching MCP's ElicitResult.action */
export type HumanResponseAction = "accept" | "decline" | "cancel";

/**
 * A request sent to a human via an IHumanConnector.
 * Schema follows MCP elicitation conventions (mode, message, requestedSchema).
 */
export interface IHumanRequest {
  /** Unique identifier for this request (used to correlate follow-ups) */
  readonly requestId: string;
  /** Target human identifier — "default" for the main user, or a specific user/role ID */
  readonly targetHumanId: string;
  /**
   * JSON schema describing the form to render for the human.
   * For MCP elicitation this is a flat object schema (no nesting).
   */
  readonly requestedSchema: DataPortSchema;
  /** Explanatory message shown to the human */
  readonly message: string;
  /** Interaction mode: single request-response or multi-turn conversation */
  readonly mode: "single" | "multi-turn";
  /** Arbitrary context data passed through to the connector (e.g. for routing, display hints) */
  readonly metadata: Record<string, unknown> | undefined;
}

/**
 * A response from a human, collected by the IHumanConnector.
 * Modelled after MCP's ElicitResult: { action, content }.
 */
export interface IHumanResponse {
  /** Correlates to the IHumanRequest.requestId */
  readonly requestId: string;
  /**
   * The human's action:
   * - "accept": user submitted data (content is present)
   * - "decline": user explicitly refused
   * - "cancel": user dismissed without choosing
   */
  readonly action: HumanResponseAction;
  /** The human's response data (present when action is "accept") */
  readonly content: Record<string, unknown> | undefined;
  /** Whether the conversation is complete. Always true for "single" mode. */
  readonly done: boolean;
}

/**
 * Interface for reaching a human and collecting input.
 *
 * The library defines this contract; UI layers provide concrete implementations.
 * The primary implementation is McpElicitationConnector which delegates to
 * MCP Server.elicitInput() for standards-based elicitation.
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
    requestedSchema: {
      type: "object",
      properties: {},
      additionalProperties: true,
      title: "Requested Schema",
      description: "JSON schema describing the form to present to the human",
      "x-ui-hidden": true,
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
  /** JSON schema describing the form to render */
  requestedSchema?: DataPortSchema;
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
  properties: {
    action: {
      type: "string",
      title: "Action",
      description: "The human's action: accept, decline, or cancel",
      enum: ["accept", "decline", "cancel"],
    },
  },
  additionalProperties: true,
} as const satisfies DataPortSchema;

export type HumanInputTaskInput = {
  prompt?: string;
  context?: Record<string, unknown>;
};

export type HumanInputTaskOutput = {
  /** The human's action */
  action: HumanResponseAction;
  /** The human's response data (present when action is "accept") */
  [key: string]: unknown;
};

// ========================================================================
// HumanInputTask
// ========================================================================

/**
 * A task that pauses graph execution to request input from a human.
 *
 * Uses the MCP elicitation model: sends a JSON schema describing the desired
 * form to an IHumanConnector, waits for the human's response, and returns it
 * as task output with an `action` field ("accept", "decline", "cancel").
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
    "Pauses execution to collect input from a human via MCP elicitation";
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
    if (this.config?.requestedSchema) {
      const configSchema = this.config.requestedSchema as Record<string, unknown>;
      const existingProps = (configSchema.properties ?? {}) as Record<string, unknown>;
      const actionProp = {
        type: "string",
        title: "Action",
        description: "The human's action: accept, decline, or cancel",
        enum: ["accept", "decline", "cancel"],
      };
      return {
        type: "object",
        properties: { action: actionProp, ...existingProps },
        additionalProperties: true,
      } as DataPortSchema;
    }
    return (this.constructor as typeof HumanInputTask).outputSchema();
  }

  override async execute(
    input: HumanInputTaskInput,
    context: IExecuteContext
  ): Promise<HumanInputTaskOutput> {
    const connector = resolveHumanConnector(context);
    const mode = this.config.mode ?? "single";
    const requestId = uuid4();

    const message = input.prompt
      ? this.config.message
        ? `${this.config.message}\n\n${input.prompt}`
        : input.prompt
      : this.config.message ?? "";

    const request: IHumanRequest = {
      requestId,
      targetHumanId: this.config.targetHumanId ?? "default",
      requestedSchema: this.config.requestedSchema ?? defaultOutputSchema,
      message,
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

    return { action: response.action, ...response.content };
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
