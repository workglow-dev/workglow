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
  Workflow,
  type IExecuteContext,
} from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";
import { uuid4 } from "@workglow/util";
import { resolveHumanConnector, type IHumanRequest } from "./HumanInputTask";

// ========================================================================
// Schemas
// ========================================================================

const humanApprovalConfigSchema = {
  type: "object",
  properties: {
    ...TaskConfigSchema["properties"],
    targetHumanId: {
      type: "string",
      title: "Target Human",
      description: "Identifier of the human to ask for approval",
      default: "default",
    },
    title: {
      type: "string",
      title: "Title",
      description: "Title for the approval request",
    },
    message: {
      type: "string",
      title: "Message",
      description: "Explanatory message shown to the approver",
      "x-ui-editor": "textarea",
    },
    metadata: {
      type: "object",
      additionalProperties: true,
      "x-ui-hidden": true,
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type HumanApprovalTaskConfig = TaskConfig & {
  /** Target human identifier — defaults to "default" */
  targetHumanId?: string;
  /** Display title */
  title?: string;
  /** Explanatory message */
  message?: string;
  /** Arbitrary metadata passed to the connector */
  metadata?: Record<string, unknown>;
};

const inputSchema = {
  type: "object",
  properties: {
    prompt: {
      type: "string",
      title: "Prompt",
      description: "Dynamic prompt text merged into the approval message",
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

const approvalOutputSchema = {
  type: "object",
  properties: {
    approved: {
      type: "boolean",
      title: "Approved",
      description: "Whether the human approved the request",
    },
    reason: {
      type: "string",
      title: "Reason",
      description: "Optional explanation for the decision",
    },
  },
  required: ["approved"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type HumanApprovalTaskInput = FromSchema<typeof inputSchema>;

export type HumanApprovalTaskOutput = {
  readonly approved: boolean;
  readonly reason?: string;
};

// ========================================================================
// HumanApprovalTask
// ========================================================================

/**
 * Convenience task for the common approve/deny pattern.
 *
 * Presents the human with an approval dialog and returns `{ approved, reason }`.
 * Always uses "single" mode — one question, one answer.
 */
export class HumanApprovalTask extends Task<
  HumanApprovalTaskInput,
  HumanApprovalTaskOutput,
  HumanApprovalTaskConfig
> {
  static override readonly type = "HumanApprovalTask";
  static override readonly category = "Flow Control";
  public static override title = "Human Approval";
  public static override description =
    "Pauses execution to request approval from a human (approve/deny)";
  static override readonly cacheable = false;

  public static override configSchema(): DataPortSchema {
    return humanApprovalConfigSchema;
  }

  static override inputSchema(): DataPortSchema {
    return inputSchema;
  }

  static override outputSchema(): DataPortSchema {
    return approvalOutputSchema;
  }

  override async execute(
    input: HumanApprovalTaskInput,
    context: IExecuteContext
  ): Promise<HumanApprovalTaskOutput> {
    const connector = resolveHumanConnector(context);
    const requestId = uuid4();

    const request: IHumanRequest = {
      requestId,
      targetHumanId: this.config.targetHumanId ?? "default",
      schema: approvalOutputSchema,
      title: this.config.title,
      message: input.prompt
        ? this.config.message
          ? `${this.config.message}\n\n${input.prompt}`
          : input.prompt
        : this.config.message,
      mode: "single",
      metadata: input.context
        ? { ...this.config.metadata, ...input.context }
        : this.config.metadata,
    };

    if (context.signal.aborted) {
      throw new TaskAbortedError("Task aborted before requesting human approval");
    }

    const response = await connector.request(request, context.signal);
    return response.data as HumanApprovalTaskOutput;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    humanApproval: CreateWorkflow<
      HumanApprovalTaskInput,
      HumanApprovalTaskOutput,
      HumanApprovalTaskConfig
    >;
  }
}

Workflow.prototype.humanApproval = CreateWorkflow(HumanApprovalTask);
