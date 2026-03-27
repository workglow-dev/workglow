# Task Config Serialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix task config serialization by snapshotting original config for toJSON, mutating config directly for resolution, and adding explicit serializability checks.

**Architecture:** Task constructor deep-copies config into `_originalConfig` for serialization. `toJSON` reads from `_originalConfig` and throws `TaskSerializationError` when `canSerializeConfig()` returns false. TaskRunner resolves format-annotated config by mutating `task.config` directly (safe because `_originalConfig` preserves the original). `IExecuteContext.resolvedConfig` is removed.

**Tech Stack:** TypeScript, vitest

**Spec:** `docs/superpowers/specs/2026-03-27-task-config-serialization-design.md`

---

### Task 1: TaskSerializationError + canSerializeConfig + _originalConfig

**Files:**
- Modify: `packages/task-graph/src/task/TaskError.ts`
- Modify: `packages/task-graph/src/task/Task.ts`
- Test: `packages/test/src/test/task/TaskJSON.test.ts` (append)

- [ ] **Step 1: Write tests for new serialization behavior**

Append to `packages/test/src/test/task/TaskJSON.test.ts`. First, add imports at the top:

```ts
import { Task, TaskConfig, TaskSerializationError } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
```

Then append these test blocks inside the existing `describe("TaskJSON", ...)` block, after the last existing test:

```ts
  describe("canSerializeConfig and _originalConfig", () => {
    class NonSerializableTask extends Task<{ value: string }, { result: string }> {
      static readonly type = "NonSerializableTask";
      static readonly category = "Test";
      static inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { value: { type: "string" } },
        } as const satisfies DataPortSchema;
      }
      static outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { result: { type: "string" } },
        } as const satisfies DataPortSchema;
      }
      canSerializeConfig(): boolean {
        return false;
      }
      async execute(input: { value: string }) {
        return { result: input.value };
      }
    }

    class MutableConfigTask extends Task<
      { value: string },
      { result: string },
      TaskConfig & { inputSchema?: unknown; discovered?: boolean }
    > {
      static readonly type = "MutableConfigTask";
      static readonly category = "Test";
      static inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { value: { type: "string" } },
        } as const satisfies DataPortSchema;
      }
      static outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { result: { type: "string" } },
        } as const satisfies DataPortSchema;
      }
      static configSchema(): DataPortSchema {
        return {
          type: "object",
          properties: {
            inputSchema: { type: "object", additionalProperties: true },
            discovered: { type: "boolean" },
          },
        } as const satisfies DataPortSchema;
      }
      async execute(input: { value: string }) {
        // Simulate runtime config mutation (like MCP discoverSchemas)
        (this.config as Record<string, unknown>).discovered = true;
        (this.config as Record<string, unknown>).inputSchema = { type: "object", properties: { name: { type: "string" } } };
        return { result: input.value };
      }
    }

    test("toJSON throws TaskSerializationError when canSerializeConfig returns false", () => {
      const task = new NonSerializableTask({}, { id: "ns1" });
      expect(() => task.toJSON()).toThrow(TaskSerializationError);
    });

    test("toJSON uses _originalConfig, not mutated this.config", async () => {
      const task = new MutableConfigTask({}, { id: "mc1" });
      await task.run({ value: "hello" });

      // Config was mutated at runtime
      expect((task.config as Record<string, unknown>).discovered).toBe(true);
      expect((task.config as Record<string, unknown>).inputSchema).toBeDefined();

      // But toJSON should use the original snapshot
      const json = task.toJSON();
      expect(json.config?.discovered).toBeUndefined();
      expect(json.config?.inputSchema).toBeUndefined();
    });

    test("canSerializeConfig returns true by default", () => {
      const task = new DoubleToResultTask({ value: 1 }, { id: "d1" });
      expect(task.canSerializeConfig()).toBe(true);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test TaskJSON`

Expected: FAIL — `TaskSerializationError` not found, `canSerializeConfig` not defined

- [ ] **Step 3: Add TaskSerializationError to TaskError.ts**

Append to `packages/task-graph/src/task/TaskError.ts` before the closing of the file:

```ts
/**
 * Thrown when toJSON is called on a task whose config contains non-serializable
 * values (e.g. functions). Tasks should override canSerializeConfig() to declare
 * whether they support serialization.
 */
export class TaskSerializationError extends TaskError {
  static readonly type: string = "TaskSerializationError";
  constructor(taskType: string) {
    super(
      `Task "${taskType}" cannot be serialized: config contains non-serializable values. ` +
        `Use a declarative config alternative or remove function-valued config properties.`
    );
  }
}
```

- [ ] **Step 4: Add _originalConfig and canSerializeConfig to Task.ts**

In `packages/task-graph/src/task/Task.ts`:

1. Add import for `TaskSerializationError` (it should already be in the same package, find where other TaskError imports are).

2. Add the `_originalConfig` field after the `config` field declaration (around line 305):

```ts
  /**
   * The configuration of the task
   */
  config: Config;

  /**
   * Frozen snapshot of config at construction time, used by toJSON.
   * Runtime mutations to this.config do not affect serialized output.
   */
  protected _originalConfig: Readonly<Record<string, unknown>>;
```

3. In the constructor, after `this.config = this.validateAndApplyConfigDefaults(baseConfig);` (line 390), add the snapshot:

```ts
    this.config = this.validateAndApplyConfigDefaults(baseConfig);
    this._originalConfig = Object.freeze(structuredClone(this.config) as Record<string, unknown>);
```

4. Add `canSerializeConfig` instance method. Place it near `toJSON` (before it):

```ts
  /**
   * Returns whether the task's config can be serialized to JSON.
   * Override in subclasses that store non-serializable values (functions) in config.
   * Called by toJSON — if false, toJSON throws TaskSerializationError.
   */
  public canSerializeConfig(): boolean {
    return true;
  }
```

5. Update `toJSON` to check canSerializeConfig and read from `_originalConfig`:

Replace the line:
```ts
      const value = (this.config as Record<string, unknown>)[key];
```
with:
```ts
      const value = (this._originalConfig as Record<string, unknown>)[key];
```

And add the canSerializeConfig check at the top of `toJSON`, right after `const ctor = ...`:

```ts
  public toJSON(_options?: TaskGraphJsonOptions): TaskGraphItemJson {
    const ctor = this.constructor as typeof Task;

    if (!this.canSerializeConfig()) {
      throw new TaskSerializationError(this.type);
    }

    // Build config by extracting only serializable properties defined in the configSchema.
    // ...
```

- [ ] **Step 5: Export TaskSerializationError**

Check that `TaskSerializationError` is exported from the task-graph package index. Find where `TaskJSONError` is exported and add `TaskSerializationError` alongside it.

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test TaskJSON`

Expected: All tests PASS (existing + 3 new)

- [ ] **Step 7: Commit**

```bash
git add packages/task-graph/src/task/TaskError.ts \
       packages/task-graph/src/task/Task.ts \
       packages/test/src/test/task/TaskJSON.test.ts
git commit -m "feat(task-graph): add _originalConfig snapshot, canSerializeConfig, and TaskSerializationError"
```

---

### Task 2: Override canSerializeConfig in LambdaTask, WhileTask, ConditionalTask

**Files:**
- Modify: `packages/tasks/src/task/LambdaTask.ts`
- Modify: `packages/task-graph/src/task/WhileTask.ts`
- Modify: `packages/task-graph/src/task/ConditionalTask.ts`
- Test: `packages/test/src/test/task/TaskJSON.test.ts` (append)

- [ ] **Step 1: Write tests for task-specific canSerializeConfig behavior**

Append to `packages/test/src/test/task/TaskJSON.test.ts`:

```ts
import { WhileTask, ConditionalTask } from "@workglow/task-graph";
import { LambdaTask } from "@workglow/tasks";

  describe("canSerializeConfig overrides", () => {
    test("LambdaTask.canSerializeConfig always returns false", () => {
      const task = new LambdaTask(
        {},
        { execute: async (input: any) => input }
      );
      expect(task.canSerializeConfig()).toBe(false);
      expect(() => task.toJSON()).toThrow(TaskSerializationError);
    });

    test("WhileTask with function condition is not serializable", () => {
      const task = new WhileTask(
        {},
        { condition: (_output: any, _i: number) => true }
      );
      expect(task.canSerializeConfig()).toBe(false);
      expect(() => task.toJSON()).toThrow(TaskSerializationError);
    });

    test("WhileTask with declarative condition is serializable", () => {
      const task = new WhileTask(
        {},
        {
          conditionField: "done",
          conditionOperator: "equals",
          conditionValue: "false",
        }
      );
      expect(task.canSerializeConfig()).toBe(true);
      expect(() => task.toJSON()).not.toThrow();
    });

    test("ConditionalTask with function branches is not serializable", () => {
      const task = new ConditionalTask(
        {},
        {
          branches: [
            { id: "a", condition: (_input: any) => true, outputPort: "out_a" },
          ],
        }
      );
      expect(task.canSerializeConfig()).toBe(false);
      expect(() => task.toJSON()).toThrow(TaskSerializationError);
    });

    test("ConditionalTask with conditionConfig is serializable", () => {
      const task = new ConditionalTask(
        {},
        {
          conditionConfig: {
            conditions: [
              {
                id: "a",
                outputPort: "out_a",
                rules: [{ field: "x", operator: "equals", value: "1" }],
                logic: "and",
              },
            ],
          },
        }
      );
      expect(task.canSerializeConfig()).toBe(true);
      expect(() => task.toJSON()).not.toThrow();
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test TaskJSON`

Expected: FAIL — LambdaTask/WhileTask/ConditionalTask canSerializeConfig still returns true

- [ ] **Step 3: Override canSerializeConfig in LambdaTask**

In `packages/tasks/src/task/LambdaTask.ts`, add inside the class body:

```ts
  public canSerializeConfig(): boolean {
    return false;
  }
```

- [ ] **Step 4: Override canSerializeConfig in WhileTask**

In `packages/task-graph/src/task/WhileTask.ts`, add inside the class body:

```ts
  public canSerializeConfig(): boolean {
    return typeof this.config.condition !== "function";
  }
```

- [ ] **Step 5: Override canSerializeConfig in ConditionalTask**

In `packages/task-graph/src/task/ConditionalTask.ts`, add inside the class body:

```ts
  public canSerializeConfig(): boolean {
    if (!this.config.branches) return true;
    return !this.config.branches.some((b) => typeof b.condition === "function");
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test TaskJSON`

Expected: All tests PASS

- [ ] **Step 7: Run full build to verify compilation**

Run: `bun run build:packages`

Expected: Clean build

- [ ] **Step 8: Commit**

```bash
git add packages/tasks/src/task/LambdaTask.ts \
       packages/task-graph/src/task/WhileTask.ts \
       packages/task-graph/src/task/ConditionalTask.ts \
       packages/test/src/test/task/TaskJSON.test.ts
git commit -m "feat: override canSerializeConfig in LambdaTask, WhileTask, and ConditionalTask"
```

---

### Task 3: Change TaskRunner to mutate task.config + remove resolvedConfig from context

**Files:**
- Modify: `packages/task-graph/src/task/TaskRunner.ts`
- Modify: `packages/task-graph/src/task/ITask.ts`
- Test: `packages/test/src/test/mcp/mcp-server-registry.test.ts` (update)

- [ ] **Step 1: Update TaskRunner to mutate task.config directly**

In `packages/task-graph/src/task/TaskRunner.ts`:

1. Remove the `resolvedConfig` field (line 112):
```ts
// DELETE this line:
  protected resolvedConfig?: Readonly<Record<string, unknown>>;
```

2. In `run()`, replace the config resolution block (lines 145-154) with:
```ts
      // Resolve config schema annotations (e.g. mcp-server references) by mutating task.config.
      // The original config is preserved in task._originalConfig for serialization.
      const configSchema = (this.task.constructor as typeof Task).configSchema();
      if (schemaHasFormatAnnotations(configSchema)) {
        const resolved = await resolveSchemaInputs(
          { ...this.task.config } as Record<string, unknown>,
          configSchema,
          { registry: this.registry }
        );
        Object.assign(this.task.config, resolved);
      }
```

3. In `runReactive()`, replace the config resolution block (lines 239-248) with the same pattern:
```ts
    // Resolve config schema annotations by mutating task.config directly
    const configSchema = (this.task.constructor as typeof Task).configSchema();
    if (schemaHasFormatAnnotations(configSchema)) {
      const resolved = await resolveSchemaInputs(
        { ...this.task.config } as Record<string, unknown>,
        configSchema,
        { registry: this.registry }
      );
      Object.assign(this.task.config, resolved);
    }
```

4. In `executeTask()`, remove `resolvedConfig` from the context object (line 319):
```ts
  protected async executeTask(input: Input): Promise<Output | undefined> {
    const result = await this.task.execute(input, {
      signal: this.abortController!.signal,
      updateProgress: this.handleProgress.bind(this),
      own: this.own,
      registry: this.registry,
    });
    return await this.executeTaskReactive(input, result || ({} as Output));
  }
```

5. In `executeStreamingTask()`, remove `resolvedConfig` from the context object (line 381):
```ts
    const stream = this.task.executeStream!(input, {
      signal: this.abortController!.signal,
      updateProgress: this.handleProgress.bind(this),
      own: this.own,
      registry: this.registry,
      inputStreams: this.inputStreams,
    });
```

- [ ] **Step 2: Remove resolvedConfig from IExecuteContext**

In `packages/task-graph/src/task/ITask.ts`, remove the `resolvedConfig` field from the `IExecuteContext` interface:

```ts
// DELETE these lines from IExecuteContext:
  /**
   * Config schema properties resolved by TaskRunner (e.g. format: "mcp-server").
   * Read-only -- task.config is never mutated.
   */
  resolvedConfig?: Readonly<Record<string, unknown>>;
```

- [ ] **Step 3: Update the ConfigResolverTestTask in mcp-server-registry.test.ts**

In `packages/test/src/test/mcp/mcp-server-registry.test.ts`, update the `ConfigResolverTestTask` and its tests. The task no longer receives `context.resolvedConfig` — it reads from `this.config` directly:

Replace the `ConfigResolverTestTask` class and its tests with:

```ts
class ConfigResolverTestTask extends Task<
  { value: string },
  { result: string; configServer: unknown },
  TaskConfig & { server?: unknown }
> {
  static readonly type = "ConfigResolverTestTask";
  static readonly category = "Test";

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        result: { type: "string" },
        configServer: { type: "object", additionalProperties: true },
      },
      required: ["result"],
    } as const satisfies DataPortSchema;
  }

  static configSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        server: { type: "string", format: "mcp-server" },
      },
    } as const satisfies DataPortSchema;
  }

  async execute(
    input: { value: string },
    _context: IExecuteContext
  ): Promise<{ result: string; configServer: unknown }> {
    return {
      result: input.value,
      configServer: (this.config as Record<string, unknown>).server,
    };
  }
}

describe("TaskRunner config resolution", () => {
  beforeEach(() => {
    getGlobalMcpServers().clear();
  });

  test("config.server is resolved to full record on task.config", async () => {
    await registerMcpServer(serverA);
    const task = new ConfigResolverTestTask({}, { server: "server-a" });
    const output = await task.run({ value: "hello" });

    // execute() reads from this.config.server — it should be the resolved object
    expect(output.configServer).toEqual(serverA);
  });

  test("original config is preserved for toJSON", async () => {
    await registerMcpServer(serverA);
    const task = new ConfigResolverTestTask({}, { server: "server-a" });
    await task.run({ value: "hello" });

    // task.config.server was mutated to the resolved object
    expect((task.config as Record<string, unknown>).server).toEqual(serverA);

    // But toJSON should use the original snapshot with the string ID
    const json = task.toJSON();
    expect(json.config?.server).toBe("server-a");
  });

  test("config resolution is a no-op when config has no format annotations", async () => {
    const task = new ConfigResolverTestTask({}, {});
    const output = await task.run({ value: "hello" });
    expect(output.configServer).toBeUndefined();
  });
});
```

- [ ] **Step 4: Build to verify compilation**

Run: `bun run build:packages`

Expected: Clean build

- [ ] **Step 5: Run MCP tests**

Run: `bun test mcp`

Expected: FAIL — MCP tasks still reference `context.resolvedConfig`

(This is expected — we fix MCP tasks in the next task.)

- [ ] **Step 6: Commit TaskRunner + IExecuteContext + test changes**

```bash
git add packages/task-graph/src/task/TaskRunner.ts \
       packages/task-graph/src/task/ITask.ts \
       packages/test/src/test/mcp/mcp-server-registry.test.ts
git commit -m "refactor(task-graph): mutate task.config for resolution, remove IExecuteContext.resolvedConfig"
```

---

### Task 4: Simplify getMcpServerConfig and update MCP tasks

**Files:**
- Modify: `packages/tasks/src/mcp-server/getMcpServerConfig.ts`
- Modify: `packages/tasks/src/task/mcp/McpToolCallTask.ts`
- Modify: `packages/tasks/src/task/mcp/McpPromptGetTask.ts`
- Modify: `packages/tasks/src/task/mcp/McpResourceReadTask.ts`
- Modify: `packages/tasks/src/task/mcp/McpListTask.ts`
- Test: `packages/test/src/test/mcp/mcp-server-registry.test.ts` (update)

- [ ] **Step 1: Simplify getMcpServerConfig signature**

Replace the entire content of `packages/tasks/src/mcp-server/getMcpServerConfig.ts`:

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { McpServerConfig } from "../util/McpTaskDeps";

const SERVER_CONFIG_KEYS: readonly string[] = [
  "transport",
  "server_url",
  "command",
  "args",
  "env",
  "auth",
  "auth_type",
  "auth_token",
  "auth_client_id",
  "auth_client_secret",
  "auth_private_key",
  "auth_algorithm",
  "auth_jwt_bearer_assertion",
  "auth_redirect_url",
  "auth_scope",
  "auth_client_name",
  "auth_jwt_lifetime_seconds",
] as const;

/**
 * Extracts a McpServerConfig from a task's config or input object.
 *
 * If `configOrInput.server` is an object (resolved from registry or inline),
 * it is used as the base. Inline transport/server_url/command/etc properties
 * on configOrInput override the server object's values.
 */
export function getMcpServerConfig(
  configOrInput: Readonly<Record<string, unknown>>
): McpServerConfig {
  let base: Record<string, unknown> = {};

  const server = configOrInput.server;
  if (server && typeof server === "object" && !Array.isArray(server)) {
    base = { ...(server as Record<string, unknown>) };
  }

  for (const key of SERVER_CONFIG_KEYS) {
    const value = configOrInput[key];
    if (value !== undefined) {
      base[key] = value;
    }
  }

  if (!base.transport) {
    throw new Error(
      "MCP server config must include a transport (from server reference or inline config)"
    );
  }

  return base as unknown as McpServerConfig;
}
```

- [ ] **Step 2: Update McpToolCallTask**

In `packages/tasks/src/task/mcp/McpToolCallTask.ts`, change the `execute` method to call `getMcpServerConfig(this.config)` instead of `getMcpServerConfig(this.config, context.resolvedConfig)`:

```ts
    const serverConfig = getMcpServerConfig(
      this.config as Record<string, unknown>
    );
```

- [ ] **Step 3: Update McpPromptGetTask**

Same change in `packages/tasks/src/task/mcp/McpPromptGetTask.ts`:

```ts
    const serverConfig = getMcpServerConfig(
      this.config as Record<string, unknown>
    );
```

- [ ] **Step 4: Update McpResourceReadTask**

Same change in `packages/tasks/src/task/mcp/McpResourceReadTask.ts`:

```ts
    const serverConfig = getMcpServerConfig(
      this.config as Record<string, unknown>
    );
```

- [ ] **Step 5: McpListTask stays the same pattern**

`packages/tasks/src/task/mcp/McpListTask.ts` already calls `getMcpServerConfig(input, undefined)`. Change to single-arg:

```ts
    const serverConfig = getMcpServerConfig(input as Record<string, unknown>);
```

- [ ] **Step 6: Update getMcpServerConfig tests**

In `packages/test/src/test/mcp/mcp-server-registry.test.ts`, update the `getMcpServerConfig` tests. The function no longer takes a second parameter. Replace the entire `describe("getMcpServerConfig", ...)` block:

```ts
describe("getMcpServerConfig", () => {
  test("returns server config from resolved server object on config", () => {
    const config = {
      server: {
        server_id: "a",
        transport: "streamable-http",
        server_url: "http://localhost:3000/mcp",
      },
    };
    const result = getMcpServerConfig(config);
    expect(result.transport).toBe("streamable-http");
    expect(result.server_url).toBe("http://localhost:3000/mcp");
  });

  test("inline config values override server object", () => {
    const config = {
      server: {
        server_id: "a",
        transport: "sse",
        server_url: "http://registry-url.com",
      },
      transport: "streamable-http",
      server_url: "http://override.com",
    };
    const result = getMcpServerConfig(config);
    expect(result.transport).toBe("streamable-http");
    expect(result.server_url).toBe("http://override.com");
  });

  test("works with inline-only config (no server reference)", () => {
    const config = {
      transport: "stdio",
      command: "node",
      args: ["server.js"],
    };
    const result = getMcpServerConfig(config);
    expect(result.transport).toBe("stdio");
    expect(result.command).toBe("node");
  });

  test("works when server is an inline object", () => {
    const config = {
      server: {
        transport: "sse",
        server_url: "http://inline.com",
      },
    };
    const result = getMcpServerConfig(config);
    expect(result.transport).toBe("sse");
    expect(result.server_url).toBe("http://inline.com");
  });

  test("throws when no transport is available from any source", () => {
    expect(() => getMcpServerConfig({})).toThrow(
      "MCP server config must include a transport"
    );
  });

  test("merges auth fields from server object", () => {
    const config = {
      server: {
        server_id: "a",
        transport: "streamable-http",
        server_url: "http://localhost:3000",
        auth_type: "bearer",
        auth_token: "secret-token",
      },
    };
    const result = getMcpServerConfig(config);
    expect((result as Record<string, unknown>).auth_type).toBe("bearer");
  });
});
```

- [ ] **Step 7: Build and run all MCP tests**

Run: `bun run build:packages && bun test mcp`

Expected: Clean build, all MCP tests pass

- [ ] **Step 8: Run full task-graph tests for regressions**

Run: `bun test TaskJSON`

Expected: All serialization tests pass

- [ ] **Step 9: Commit**

```bash
git add packages/tasks/src/mcp-server/getMcpServerConfig.ts \
       packages/tasks/src/task/mcp/McpToolCallTask.ts \
       packages/tasks/src/task/mcp/McpPromptGetTask.ts \
       packages/tasks/src/task/mcp/McpResourceReadTask.ts \
       packages/tasks/src/task/mcp/McpListTask.ts \
       packages/test/src/test/mcp/mcp-server-registry.test.ts
git commit -m "refactor(tasks): simplify getMcpServerConfig to single-arg, update MCP tasks"
```
