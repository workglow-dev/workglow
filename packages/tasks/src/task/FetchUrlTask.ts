/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AbortSignalJobError,
  IJobExecuteContext,
  Job,
  PermanentJobError,
  RetryableJobError,
} from "@workglow/job-queue";
import {
  CreateWorkflow,
  type IExecuteContext,
  getJobQueueFactory,
  getTaskQueueRegistry,
  JobTaskFailedError,
  Task,
  TaskConfigSchema,
  TaskConfigurationError,
  TaskInvalidInputError,
  Workflow,
  type RegisteredQueue,
  type TaskConfig,
} from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";

const PRIVATE_IP_RANGES = [
  /^127\./, // loopback
  /^10\./, // Class A private
  /^172\.(1[6-9]|2\d|3[01])\./, // Class B private
  /^192\.168\./, // Class C private
  /^169\.254\./, // link-local
  /^0\./, // current network
  /^fc00:/i, // IPv6 unique local
  /^fe80:/i, // IPv6 link-local
  /^::1$/, // IPv6 loopback
  /^::$/, // IPv6 unspecified
];

const PRIVATE_HOSTNAMES = new Set(["localhost", "metadata.google.internal", "metadata.internal"]);

function isPrivateUrl(urlStr: string): boolean {
  if (globalThis?.process?.env?.WORKGLOW_ALLOW_PRIVATE_URLS === "true") {
    return false;
  }
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");

    if (PRIVATE_HOSTNAMES.has(hostname) || hostname.endsWith(".local")) {
      return true;
    }

    for (const range of PRIVATE_IP_RANGES) {
      if (range.test(hostname)) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

const inputSchema = {
  type: "object",
  properties: {
    url: {
      type: "string",
      title: "URL",
      description: "The URL to fetch from",
      format: "uri",
    },
    method: {
      enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
      title: "Method",
      description: "The HTTP method to use",
      default: "GET",
    },
    headers: {
      type: "object",
      additionalProperties: {
        type: "string",
      },
      title: "Headers",
      description: "The headers to send with the request",
    },
    body: {
      type: "string",
      title: "Body",
      description: "The body of the request",
    },
    response_type: {
      anyOf: [{ type: "null" }, { enum: ["json", "text", "blob", "arraybuffer"] }],
      title: "Response Type",
      description:
        "The forced type of response to return. If null, the response type is inferred from the Content-Type header.",
      default: null,
    },
    timeout: {
      type: "number",
      title: "Timeout",
      description: "Request timeout in milliseconds",
    },
    credential_key: {
      type: "string",
      format: "credential",
      title: "Credential Key",
      description:
        "Key to look up in the credential store. The resolved value is sent as a Bearer token in the Authorization header.",
      "x-ui-hidden": true,
    },
  },
  required: ["url"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    json: {
      title: "JSON",
      description: "The JSON response",
    },
    text: {
      type: "string",
      title: "Text",
      description: "The text response",
    },
    blob: {
      title: "Blob",
      description: "The blob response",
    },
    arraybuffer: {
      title: "ArrayBuffer",
      description: "The arraybuffer response",
    },
    metadata: {
      type: "object",
      properties: {
        contentType: { type: "string" },
        headers: { type: "object", additionalProperties: { type: "string" } },
      },
      additionalProperties: false,
      title: "Response Metadata",
      description: "HTTP response metadata including content type and headers",
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type FetchUrlTaskInput = FromSchema<typeof inputSchema>;
export type FetchUrlTaskOutput = FromSchema<typeof outputSchema>;

async function fetchWithProgress(
  url: string,
  options: RequestInit = {},
  onProgress?: (progress: number) => Promise<void>
): Promise<Response> {
  if (!options.signal) {
    throw new TaskConfigurationError("An AbortSignal must be provided.");
  }

  const response = await globalThis.fetch(url, options);
  if (!response.body) {
    throw new Error("ReadableStream not supported in this environment.");
  }

  const contentLength = response.headers.get("Content-Length");
  const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
  let receivedBytes = 0;
  const reader = response.body.getReader();

  // Create a new ReadableStream that supports progress updates
  const stream = new ReadableStream({
    start(controller) {
      async function push() {
        try {
          while (true) {
            // Check if the request was aborted
            if (options.signal?.aborted) {
              controller.error(new AbortSignalJobError("Fetch aborted"));
              reader.cancel();
              return;
            }

            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              break;
            }
            controller.enqueue(value);
            receivedBytes += value.length;
            if (onProgress && totalBytes) {
              await onProgress((receivedBytes / totalBytes) * 100);
            }
          }
        } catch (error) {
          controller.error(error);
        }
      }
      push();
    },
    cancel() {
      reader.cancel();
    },
  });

  return new Response(stream, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

/**
 * Extends the base Job class to provide custom execution functionality
 * through a provided function.
 */
export class FetchUrlJob<
  Input extends FetchUrlTaskInput = FetchUrlTaskInput,
  Output = FetchUrlTaskOutput,
> extends Job<Input, Output> {
  static readonly type: string = "FetchUrlJob";
  /**
   * Executes the job using the provided function.
   */
  async execute(input: Input, context: IJobExecuteContext): Promise<Output> {
    if (isPrivateUrl(input.url!)) {
      throw new PermanentJobError(
        `Requests to private/internal networks are not allowed: ${input.url}. ` +
          `Set WORKGLOW_ALLOW_PRIVATE_URLS=true to override.`
      );
    }

    const response = await fetchWithProgress(
      input.url!,
      {
        method: input.method,
        headers: input.headers,
        body: input.body,
        signal: context.signal,
      },
      async (progress: number) => await context.updateProgress(progress)
    );

    if (response.ok) {
      // Extract metadata from response
      const contentType = response.headers.get("content-type") ?? "";
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const metadata = {
        contentType,
        headers: responseHeaders,
      };

      // Infer response type from response headers if not specified
      let resolvedResponseType = input.response_type;
      if (!resolvedResponseType) {
        if (contentType.includes("application/json")) {
          resolvedResponseType = "json";
        } else if (contentType.includes("text/")) {
          resolvedResponseType = "text";
        } else if (contentType.includes("application/octet-stream")) {
          resolvedResponseType = "arraybuffer";
        } else if (
          contentType.includes("application/pdf") ||
          contentType.includes("image/") ||
          contentType.includes("application/zip")
        ) {
          resolvedResponseType = "blob";
        } else {
          resolvedResponseType = "json"; // Default fallback
        }
      }
      if (resolvedResponseType === "json") {
        return { json: await response.json(), metadata } as Output;
      } else if (resolvedResponseType === "text") {
        return { text: await response.text(), metadata } as Output;
      } else if (resolvedResponseType === "blob") {
        return { blob: await response.blob(), metadata } as Output;
      } else if (resolvedResponseType === "arraybuffer") {
        return { arraybuffer: await response.arrayBuffer(), metadata } as Output;
      }
      throw new TaskInvalidInputError(`Invalid response type: ${resolvedResponseType}`);
    } else {
      if (
        response.status === 429 ||
        response.status === 503 ||
        response.headers.get("Retry-After")
      ) {
        let retryDate: Date | undefined;
        const retryAfterStr = response.headers.get("Retry-After");
        if (retryAfterStr) {
          // Try parsing as seconds first (the common case)
          const seconds = Number(retryAfterStr);
          if (Number.isFinite(seconds) && seconds > 0) {
            retryDate = new Date(Date.now() + seconds * 1000);
          } else {
            // Fall back to HTTP date parsing
            const parsedDate = new Date(retryAfterStr);
            if (!isNaN(parsedDate.getTime()) && parsedDate > new Date()) {
              retryDate = parsedDate;
            }
          }
        }

        throw new RetryableJobError(
          `Failed to fetch ${input.url}: ${response.status} ${response.statusText}`,
          retryDate
        );
      } else {
        throw new PermanentJobError(
          `Failed to fetch ${input.url}: ${response.status} ${response.statusText}`
        );
      }
    }
  }
}

/**
 * FetchUrlTask provides a task for fetching data from a URL.
 */
const fetchUrlTaskConfigSchema = {
  type: "object",
  properties: {
    ...TaskConfigSchema["properties"],
    queue: {
      oneOf: [{ type: "boolean" }, { type: "string" }],
      description: "Queue handling: false=run inline, true=use default, string=explicit queue name",
      "x-ui-hidden": true,
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type FetchUrlTaskConfig = TaskConfig & {
  queue?: boolean | string;
};

export class FetchUrlTask<
  Input extends FetchUrlTaskInput = FetchUrlTaskInput,
  Output extends FetchUrlTaskOutput = FetchUrlTaskOutput,
  Config extends FetchUrlTaskConfig = FetchUrlTaskConfig,
> extends Task<Input, Output, Config> {
  public static type = "FetchUrlTask";
  public static category = "Input";
  public static title = "Fetch";
  public static description =
    "Fetches data from a URL with progress tracking and automatic retry handling";
  public static hasDynamicSchemas: boolean = true;

  public static configSchema(): DataPortSchema {
    return fetchUrlTaskConfigSchema;
  }

  public static inputSchema() {
    return inputSchema;
  }

  public static outputSchema() {
    return outputSchema;
  }

  /**
   * Override outputSchema to compute it dynamically based on the current response_type value.
   * If response_type is null, all output types are available.
   * If response_type is a specific value (e.g., "json"), only that output type is available.
   */
  public override outputSchema(): DataPortSchema {
    // Get the current response_type value from runInputData (if set) or defaults
    // runInputData takes precedence as it contains the most recent input values
    const responseType = this.runInputData?.response_type ?? this.defaults?.response_type ?? null;

    // If response_type is null or undefined, return all output types (static schema)
    if (responseType === null || responseType === undefined) {
      return (this.constructor as typeof FetchUrlTask).outputSchema();
    }

    // If response_type is a specific value, return only that output type
    const staticSchema = (this.constructor as typeof FetchUrlTask).outputSchema();
    if (typeof staticSchema === "boolean") {
      return staticSchema;
    }

    if (!staticSchema.properties) {
      return staticSchema;
    }

    // Build properties object with only the selected response type
    const properties: Record<string, any> = {};
    if (responseType === "json" && staticSchema.properties.json) {
      properties.json = staticSchema.properties.json;
    } else if (responseType === "text" && staticSchema.properties.text) {
      properties.text = staticSchema.properties.text;
    } else if (responseType === "blob" && staticSchema.properties.blob) {
      properties.blob = staticSchema.properties.blob;
    } else if (responseType === "arraybuffer" && staticSchema.properties.arraybuffer) {
      properties.arraybuffer = staticSchema.properties.arraybuffer;
    }

    // Always include metadata
    if (staticSchema.properties.metadata) {
      properties.metadata = staticSchema.properties.metadata;
    }

    // If no properties were added (shouldn't happen with valid responseType), return static schema
    if (Object.keys(properties).length === 0) {
      return staticSchema;
    }

    return {
      type: "object",
      properties,
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  /**
   * Executes the fetch task, either directly or via a job queue depending on
   * the `queue` config/input. Credential resolution is handled by the input
   * resolver system — credential_key arrives already resolved.
   */
  override async execute(
    input: FetchUrlTaskInput,
    executeContext: IExecuteContext
  ): Promise<Output> {
    // Apply credential as Authorization header and strip it from the payload
    // so the secret is not persisted to queue storage.
    const credential = input.credential_key;
    let jobInput: FetchUrlTaskInput = input;
    if (credential) {
      const { credential_key: _omit, ...rest } = input;
      jobInput = {
        ...rest,
        headers: { ...input.headers, Authorization: `Bearer ${credential}` },
      };
    }

    const queuePref = this.config.queue ?? false;
    let cleanup: () => void = () => {};

    try {
      if (queuePref === false) {
        // Direct execution — create FetchUrlJob and run inline
        const job = new FetchUrlJob<FetchUrlTaskInput, Output>({ input: jobInput });
        cleanup = job.onJobProgress(
          (progress: number, message: string, details: Record<string, any> | null) => {
            executeContext.updateProgress(progress, message, details);
          }
        );
        return await job.execute(jobInput, {
          signal: executeContext.signal,
          updateProgress: executeContext.updateProgress.bind(this),
        });
      }

      // Queued execution
      const queueName =
        typeof queuePref === "string" ? queuePref : await this.getDefaultQueueName(input);

      if (!queueName) {
        throw new TaskConfigurationError("FetchUrlTask: Unable to determine queue name");
      }

      const registeredQueue = await this.resolveOrCreateQueue(queueName);

      // Bail early to avoid enqueuing work that has already been cancelled.
      if (executeContext.signal.aborted) {
        throw (
          executeContext.signal.reason ??
          new DOMException("The operation was aborted", "AbortError")
        );
      }

      const handle = await registeredQueue.client.submit(jobInput as Input, {
        jobRunId: this.runConfig.runnerId,
        maxRetries: 10,
      });

      // Wire abort signal to queued job
      const onAbort = () => {
        handle.abort().catch((err) => {
          console.warn(`Failed to abort queued fetch job`, err);
        });
      };
      executeContext.signal.addEventListener("abort", onAbort);

      cleanup = handle.onProgress(
        (progress: number, message: string | undefined, details: Record<string, any> | null) => {
          executeContext.updateProgress(progress, message, details);
        }
      );

      try {
        if (executeContext.signal.aborted) {
          throw (
            executeContext.signal.reason ??
            new DOMException("The operation was aborted", "AbortError")
          );
        }
        const output = await handle.waitFor();
        return output as Output;
      } finally {
        executeContext.signal.removeEventListener("abort", onAbort);
      }
    } catch (err: any) {
      throw new JobTaskFailedError(err);
    } finally {
      cleanup();
    }
  }

  private async resolveOrCreateQueue(queueName: string): Promise<RegisteredQueue<Input, Output>> {
    const registry = getTaskQueueRegistry();
    let registeredQueue = registry.getQueue<Input, Output>(queueName);

    if (!registeredQueue) {
      const factory = getJobQueueFactory();
      registeredQueue = await factory({
        queueName,
        jobClass: FetchUrlJob as any,
        config: this.config,
        task: this,
      });

      try {
        registry.registerQueue(registeredQueue);
      } catch (err) {
        if (err instanceof Error && err.message.includes("already exists")) {
          const existing = registry.getQueue<Input, Output>(queueName);
          if (existing) {
            // Another concurrent call won the race. Stop the server we just
            // created (safe no-op if not yet started) and use the winner's queue.
            registeredQueue.server.stop().catch((stopErr) => {
              console.warn("FetchUrlTask: failed to stop raced-out queue server", stopErr);
            });
            registeredQueue = existing;
          }
        } else {
          throw err;
        }
      }
    }

    if (!registeredQueue.server.isRunning()) {
      await registeredQueue.server.start();
    }

    return registeredQueue;
  }

  /**
   * Override setInput to detect when response_type changes and emit schemaChange event.
   * This ensures that consumers of the task are notified when the output schema changes.
   */
  public override setInput(input: Partial<Input>): void {
    // Only check for changes if response_type is being set
    if (!("response_type" in input)) {
      super.setInput(input);
      return;
    }

    // Get the current response_type before updating
    // Check runInputData first (most recent), then defaults, then null
    const getCurrentResponseType = () => {
      return this.runInputData?.response_type ?? this.defaults?.response_type ?? null;
    };

    const previousResponseType = getCurrentResponseType();

    // Call parent to update the input
    super.setInput(input);

    // Get the new response_type after updating (from runInputData, which is what setInput updates)
    const newResponseType = getCurrentResponseType();

    // If response_type changed, emit schemaChange event
    // Compare using strict equality (handles null/undefined correctly)
    if (previousResponseType !== newResponseType) {
      this.emitSchemaChange();
    }
  }

  private async getDefaultQueueName(input: FetchUrlTaskInput): Promise<string | undefined> {
    if (!input.url) {
      return `fetch:${this.type}`;
    }
    try {
      const hostname = new URL(input.url).hostname.toLowerCase();
      const parts = hostname.split(".").filter(Boolean);
      if (parts.length === 0) {
        return `fetch:${this.type}`;
      }
      const domain = parts.length <= 2 ? parts.join(".") : parts.slice(-2).join(".");
      return `fetch:${domain}`;
    } catch {
      return `fetch:${this.type}`;
    }
  }
}

export const fetchUrl = async (
  input: FetchUrlTaskInput,
  config: FetchUrlTaskConfig = {}
): Promise<FetchUrlTaskOutput> => {
  const result = await new FetchUrlTask({}, config).run(input);
  return result as FetchUrlTaskOutput;
};

declare module "@workglow/task-graph" {
  interface Workflow {
    fetch: CreateWorkflow<FetchUrlTaskInput, FetchUrlTaskOutput, FetchUrlTaskConfig>;
  }
}

Workflow.prototype.fetch = CreateWorkflow(FetchUrlTask);
