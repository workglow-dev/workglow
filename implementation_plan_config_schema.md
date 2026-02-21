# Implementation Plan: Task Configuration Schema

## Objective

Introduce a standardized `configSchema` pattern to the `Task` architecture. This will provide runtime validation, automatic default value application, and static type inference for Task configurations, mirroring the existing `inputSchema` and `outputSchema` patterns.

## Prerequisites

- Ensure `ajv` is installed for JSON Schema validation.
  ```bash
  npm install ajv
  ```

## Step 1: Update Base Task Class

**File:** `src/Task.ts`

Modify the abstract `Task` class to accept a third generic argument for `Config`, add the static schema accessor, and implement validation logic in the constructor.

```typescript
import Ajv from "ajv";
import { DataPortSchemaObject } from "./types"; // Adjust import path as needed

// Initialize Ajv with default coercion and useDefaults enabled
const ajv = new Ajv({
  useDefaults: true,
  coerceTypes: true,
  allErrors: true,
});

// Cache compiled validators to avoid recompiling on every task instantiation
const validatorCache = new Map<string, any>();

export abstract class Task<
  Input = any,
  Output = any,
  Config = Record<string, any>, // Default to loose typing for backward compatibility
> {
  // 1. Add Static Schema Accessor
  public static configSchema?: () => DataPortSchemaObject;

  public runInputData: Input;
  public runOutputData: Output;
  public config: Config;

  constructor(inputDefaults: Partial<Input>, config: Config) {
    // ... existing input initialization ...

    // 2. Validate and Apply Defaults to Config
    this.config = this.validateConfig(config);
  }

  /**
   * Validates the config against the schema (if present) and applies default values.
   */
  private validateConfig(config: Config): Config {
    const ctor = this.constructor as typeof Task;

    // If no schema is defined, return config as-is (Backward Compatibility)
    if (!ctor.configSchema) {
      return config;
    }

    const schema = ctor.configSchema();
    const schemaKey = ctor.name; // Simple cache key based on class name

    let validate = validatorCache.get(schemaKey);
    if (!validate) {
      validate = ajv.compile(schema);
      validatorCache.set(schemaKey, validate);
    }

    // Clone config to ensure we don't mutate the original reference unexpectedly
    // Ajv will mutate 'configToValidate' to insert defaults
    const configToValidate = { ...config };
    const valid = validate(configToValidate);

    if (!valid) {
      const errors = ajv.errorsText(validate.errors);
      throw new Error(`[${ctor.name}] Configuration Error: ${errors}`);
    }

    return configToValidate;
  }

  // ... rest of the class (execute, etc.)
}
```

## Step 2: Update Type Definitions (Optional)

**File:** `src/types.ts` (or equivalent)

Ensure `FromSchema` or equivalent type helpers are exported to allow developers to infer types from their JSON schemas easily.

```typescript
import { FromSchema } from "json-schema-to-ts";
// Re-export for convenience if not already present
export { FromSchema };
```

## Step 3: Migration Strategy

1.  **Existing Tasks**: Existing tasks extending `Task<Input, Output>` will default `Config` to `Record<string, any>`. They will continue to work without changes.
2.  **New Tasks**: Should define a schema and pass the inferred type as the 3rd generic.
3.  **Refactoring**: When refactoring old tasks, move manual default logic (e.g., `this.config.val || 5`) into the JSON Schema `default` property.

```

<!--
[PROMPT_SUGGESTION]Implement the changes to the Task class as described in the plan.[/PROMPT_SUGGESTION]
[PROMPT_SUGGESTION]Create a new task that uses this config schema pattern for validation.[/PROMPT_SUGGESTION]
-->
```
