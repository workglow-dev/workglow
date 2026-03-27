# Task Config Serialization Design

Fix two problems with how Task handles config serialization and runtime state.

## Problems

**1. Silent data loss on non-serializable configs.** LambdaTask stores `execute` as a function. WhileTask stores `condition`. ConditionalTask stores `branches` with condition functions. The current `toJSON` silently skips these, producing incomplete output. Consuming applications get a partial config that can't reconstruct the task.

**2. Config used as mutable runtime state.** MCP tasks mutate `this.config.inputSchema` during `discoverSchemas`. The input resolver (from the MCP server registry work) writes resolved objects onto config via `context.resolvedConfig`. Config has become a mix of user intent and runtime state, making serialization unreliable.

## Design

### Original config snapshot for toJSON

At construction, Task deep-copies config into a private `_originalConfig` field. `toJSON` reads from `_originalConfig` instead of `this.config`. This preserves the user's original intent regardless of runtime mutations.

```ts
class Task {
  protected _originalConfig: Readonly<Record<string, unknown>>;
  config: Config; // mutable at runtime

  constructor(input, config, runConfig) {
    // ... existing setup ...
    this.config = this.validateAndApplyConfigDefaults(baseConfig);
    this._originalConfig = Object.freeze(structuredClone(this.config));
  }
}
```

`toJSON` changes from reading `this.config` to reading `this._originalConfig`:

```ts
public toJSON(): TaskGraphItemJson {
  const ctor = this.constructor as typeof Task;
  const schema = ctor.configSchema();
  // ... existing schema filtering logic, but reads from this._originalConfig ...
  const value = (this._originalConfig as Record<string, unknown>)[key];
  // ...
}
```

### Config resolution moves to task.config mutation

Remove `IExecuteContext.resolvedConfig`. Instead, TaskRunner resolves format-annotated config properties by writing directly onto `this.task.config` — the same pattern used for `runInputData`. This is safe because `_originalConfig` preserves the original for serialization.

In TaskRunner.run() and runReactive():

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

Tasks then just read `this.config.server` directly in execute — no context threading needed.

### Simplify getMcpServerConfig

The helper no longer needs a `resolvedConfig` parameter. It just reads from `this.config` since the resolved server object is already there:

```ts
export function getMcpServerConfig(
  configOrInput: Readonly<Record<string, unknown>>
): McpServerConfig
```

MCP tasks call: `getMcpServerConfig(this.config as Record<string, unknown>)`

McpListTask (input-based) calls: `getMcpServerConfig(input as Record<string, unknown>)`

### canSerializeConfig

Instance method on Task that subclasses override to declare whether their config is serializable:

```ts
class Task {
  canSerializeConfig(): boolean {
    return true;
  }
}
```

Tasks with functions in config override:

```ts
// LambdaTask — always has a function, never serializable
class LambdaTask {
  canSerializeConfig(): boolean {
    return false;
  }
}

// WhileTask — serializable only when using conditionField/conditionOperator/conditionValue
// (not a native condition function)
class WhileTask {
  canSerializeConfig(): boolean {
    return typeof this.config.condition !== "function";
  }
}

// ConditionalTask — serializable only when using conditionConfig (not native branch functions)
class ConditionalTask {
  canSerializeConfig(): boolean {
    return !this.config.branches?.some(b => typeof b.condition === "function");
  }
}
```

### TaskSerializationError

New error class in TaskError.ts:

```ts
export class TaskSerializationError extends TaskError {
  static readonly type: string = "TaskSerializationError";
  constructor(taskType: string) {
    super(
      `Task "${taskType}" cannot be serialized: config contains non-serializable values (functions). ` +
      `Use the declarative config alternative (e.g. conditionField/conditionOperator/conditionValue) ` +
      `or remove function-valued config properties.`
    );
  }
}
```

### toJSON throws on non-serializable

```ts
public toJSON(): TaskGraphItemJson {
  if (!this.canSerializeConfig()) {
    throw new TaskSerializationError(this.type);
  }
  // ... existing logic reading from _originalConfig ...
}
```

## Changes Summary

### task-graph package
- `Task.ts`: add `_originalConfig` snapshot in constructor, `canSerializeConfig()` instance method, update `toJSON` to read from `_originalConfig` and throw on non-serializable
- `TaskError.ts`: add `TaskSerializationError`
- `TaskRunner.ts`: resolve config by mutating `task.config` directly, remove `resolvedConfig` from context, remove `schemaHasFormatAnnotations` guard (keep it — still useful as fast-path)
- `ITask.ts`: remove `resolvedConfig` from `IExecuteContext`
- `InputResolver.ts`: keep `schemaHasFormatAnnotations` export (still used by TaskRunner)

### tasks package
- `getMcpServerConfig.ts`: simplify signature to single `configOrInput` parameter
- `McpToolCallTask.ts`, `McpPromptGetTask.ts`, `McpResourceReadTask.ts`: call `getMcpServerConfig(this.config)` instead of `getMcpServerConfig(this.config, context.resolvedConfig)`
- `McpListTask.ts`: call `getMcpServerConfig(input)` (unchanged pattern)
- `LambdaTask.ts`: override `canSerializeConfig` to return false
- `WhileTask.ts`: override instance `canSerializeConfig` to check for function condition
- `ConditionalTask.ts`: override instance `canSerializeConfig` to check for function branches

### Tests
- Test that `toJSON` uses `_originalConfig` (mutating config at runtime doesn't affect serialized output)
- Test that `toJSON` throws `TaskSerializationError` for LambdaTask
- Test that WhileTask with function condition throws, but with conditionField config serializes fine
- Test that ConditionalTask with function branches throws, but with conditionConfig serializes fine
- Update MCP task tests to remove `context.resolvedConfig` usage
- Existing MCP registry tests continue to work (server resolution now on config directly)

## Backward Compatibility

- `toJSON` output is unchanged for all existing serializable tasks
- Tasks that were silently producing broken JSON now throw — this is intentional. Consumers relying on the silent partial output need to handle the error or switch to declarative config.
- `IExecuteContext.resolvedConfig` is removed — any code reading it must read from `this.config` instead. This only affects code written in the current branch (MCP server registry).
