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
// Human connector types — unified schema-driven interactions
// ========================================================================

/**
 * The kind of interaction being requested.
 *
 * - "notify":  One-way message, no response expected. Fire-and-forget.
 * - "display": Present rich content (markdown, data, visualization hints).
 *              Response optional (acknowledgment).
 * - "elicit":  Request structured input via a form schema (MCP elicitation).
 *              Response expected with user-submitted data.
 */
export type HumanInteractionKind = "notify" | "display" | "elicit";

/** User action in response to an interaction (MCP-aligned for "elicit" kind) */
export type HumanResponseAction = "accept" | "decline" | "cancel";

/**
 * A unified request sent to a human via an IHumanConnector.
 *
 * The `kind` field determines the interaction pattern. The `content` schema
 * describes WHAT to render — the UI layer interprets it based on `kind`.
 */
export interface IHumanRequest {
  /** Unique identifier for this request (used to correlate responses) */
  readonly requestId: string;
  /** Target human identifier — "default" for the main user, or a specific user/role ID */
  readonly targetHumanId: string;
  /** What kind of interaction this is */
  readonly kind: HumanInteractionKind;
  /** Explanatory message shown to the human */
  readonly message: string;
  /**
   * Content schema — describes what to render.
   *
   * For "notify":  Describes notification content (may be empty, message suffices).
   * For "display": Describes the data/visualization to present. Properties contain
   *                the actual data to render. Use x-ui-viewer annotations for hints.
   * For "elicit":  Describes the form fields for user input (MCP requestedSchema).
   */
  readonly contentSchema: DataPortSchema;
  /**
   * Concrete data to display (for "notify" and "display" kinds).
   * For "elicit", this is typically empty — the human provides the data.
   */
  readonly contentData: Record<string, unknown> | undefined;
  /** Whether a response is expected. Default: true for "elicit", false for "notify"/"display". */
  readonly expectsResponse: boolean;
  /** Interaction mode: single request-response or multi-turn conversation */
  readonly mode: "single" | "multi-turn";
  /** Arbitrary context data passed through to the connector */
  readonly metadata: Record<string, unknown> | undefined;
}

/**
 * A response from a human, collected by the IHumanConnector.
 * For "notify"/"display" interactions, this may just be an acknowledgment.
 */
export interface IHumanResponse {
  /** Correlates to the IHumanRequest.requestId */
  readonly requestId: string;
  /**
   * The human's action:
   * - "accept": user submitted data or acknowledged
   * - "decline": user explicitly refused
   * - "cancel": user dismissed without choosing
   */
  readonly action: HumanResponseAction;
  /** The human's response data (present when action is "accept" and kind is "elicit") */
  readonly content: Record<string, unknown> | undefined;
  /** Whether the conversation is complete. Always true for "single" mode. */
  readonly done: boolean;
}

/**
 * Interface for reaching a human and sending interactions.
 *
 * Unified schema-driven: the `kind` field in IHumanRequest determines the
 * interaction pattern. The connector renders accordingly — a notification
 * toast, a data visualization, or an input form.
 *
 * The primary MCP-backed implementation is McpElicitationConnector.
 */
export interface IHumanConnector {
  /**
   * Send an interaction to a human.
   *
   * For "notify" and "display" kinds that don't expect a response, the
   * connector may resolve immediately with action "accept" and no content.
   *
   * For "elicit" kind, blocks until the human submits, declines, or cancels.
   * Must respect the AbortSignal for cancellation.
   */
  send(request: IHumanRequest, signal: AbortSignal): Promise<IHumanResponse>;

  /**
   * Send a follow-up in a multi-turn conversation.
   * Only called when mode is "multi-turn" and the previous response had done=false.
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
    kind: {
      type: "string",
      title: "Kind",
      description: "Interaction kind: notify (one-way), display (show content), elicit (request input)",
      enum: ["notify", "display", "elicit"],
      default: "elicit",
    },
    contentSchema: {
      type: "object",
      properties: {},
      additionalProperties: true,
      title: "Content Schema",
      description: "JSON schema describing the content/form to present",
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
  /** Interaction kind — defaults to "elicit" */
  kind?: HumanInteractionKind;
  /** JSON schema describing the content/form to render */
  contentSchema?: DataPortSchema;
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
    contentData: {
      type: "object",
      additionalProperties: true,
      title: "Content Data",
      description: "Data to display (for notify/display kinds)",
      "x-ui-hidden": true,
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
  contentData?: Record<string, unknown>;
  context?: Record<string, unknown>;
};

export type HumanInputTaskOutput = {
  /** The human's action */
  action: HumanResponseAction;
  /** Additional response data (for elicit kind) */
  [key: string]: unknown;
};

// ========================================================================
// HumanInputTask
// ========================================================================

/**
 * A task that sends an interaction to a human via an IHumanConnector.
 *
 * Supports three interaction kinds:
 * - "notify": Send a notification (fire-and-forget, task completes immediately)
 * - "display": Present content to the human (charts, data, markdown)
 * - "elicit": Request structured input via a form (MCP elicitation model)
 *
 * The contentSchema describes WHAT to render. The kind determines HOW.
 * For "elicit", the output includes the human's submitted data.
 * For "notify"/"display", the output is just `{ action: "accept" }`.
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
    "Sends an interaction (notification, display, or input request) to a human";
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
    if (this.config?.contentSchema && (this.config.kind ?? "elicit") === "elicit") {
      const configSchema = this.config.contentSchema as Record<string, unknown>;
      const existingProps = (configSchema.properties ?? {}) as Record<string, unknown>;
      const additionalProperties = configSchema.additionalProperties ?? false;
      const actionProp = {
        type: "string",
        title: "Action",
        description: "The human's action: accept, decline, or cancel",
        enum: ["accept", "decline", "cancel"],
      };
      return {
        type: "object",
        properties: { ...existingProps, action: actionProp },
        required: ["action"],
        additionalProperties,
      } as DataPortSchema;
    }
    return (this.constructor as typeof HumanInputTask).outputSchema();
  }

  override async execute(
    input: HumanInputTaskInput,
    context: IExecuteContext
  ): Promise<HumanInputTaskOutput> {
    const connector = resolveHumanConnector(context);
    const kind = this.config.kind ?? "elicit";
    const mode = this.config.mode ?? "single";
    const requestId = uuid4();

    const message = input.prompt
      ? this.config.message
        ? `${this.config.message}\n\n${input.prompt}`
        : input.prompt
      : this.config.message ?? "";

    const emptySchema: DataPortSchema = {
      type: "object",
      properties: {},
      additionalProperties: true,
    };

    const request: IHumanRequest = {
      requestId,
      targetHumanId: this.config.targetHumanId ?? "default",
      kind,
      message,
      contentSchema: this.config.contentSchema ?? emptySchema,
      contentData: input.contentData,
      expectsResponse: kind === "elicit",
      mode: kind === "elicit" ? mode : "single",
      metadata: input.context
        ? { ...this.config.metadata, ...input.context }
        : this.config.metadata,
    };

    if (context.signal.aborted) {
      throw new TaskAbortedError("Task aborted before sending human interaction");
    }

    let response: IHumanResponse;
    try {
      response = await connector.send(request, context.signal);
    } catch (err) {
      if (context.signal.aborted) {
        throw new TaskAbortedError("Task aborted during human interaction");
      }
      throw err;
    }

    if (kind === "elicit" && mode === "multi-turn" && !response.done) {
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
        try {
          response = await connector.followUp(request, response, context.signal);
        } catch (err) {
          if (context.signal.aborted) {
            throw new TaskAbortedError("Task aborted during multi-turn conversation");
          }
          throw err;
        }
      }
    }

    return { ...response.content, action: response.action };
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
