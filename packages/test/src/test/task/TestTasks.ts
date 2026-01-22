/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * This file contains various task implementations used for testing the task graph
 * system. It includes basic task types, specialized testing tasks, and examples
 * of different task behaviors like error handling and progress reporting.
 */

import {
  CreateWorkflow,
  IExecuteContext,
  Task,
  TaskAbortedError,
  TaskConfig,
  TaskError,
  TaskFailedError,
  TaskInput,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema, sleep } from "@workglow/util";

/**
 * Standard input type for basic test tasks
 */
export type TestIOTaskInput = {
  key: string;
};

/**
 * Standard output type for basic test tasks with flags for different run modes
 */
export type TestIOTaskOutput = {
  reactiveOnly: boolean; // Indicates if the result came from reactive run
  all: boolean; // Indicates if the result came from full run
  key: string; // Echo of the input key
};

/**
 * Basic implementation of a test task with both reactive and full run modes
 * Used as a foundation for testing task execution and data flow
 */
export class TestIOTask extends Task<TestIOTaskInput, TestIOTaskOutput> {
  static readonly type = "TestIOTask";

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        key: {
          type: "string",
          default: "default",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        reactiveOnly: {
          type: "boolean",
        },
        all: {
          type: "boolean",
        },
        key: {
          type: "string",
          default: "default",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  /**
   * Implementation of reactive run mode
   * if execute ran then there will be output data
   * if not then we send the input data
   */
  async executeReactive(
    input: TestIOTaskInput,
    output: TestIOTaskOutput
  ): Promise<TestIOTaskOutput> {
    return {
      all: output.all ?? false,
      key: output.key !== "default" && output.key !== undefined ? output.key : input.key,
      reactiveOnly: output.reactiveOnly ?? true,
    };
  }

  /**
   * Implementation of full run mode - returns complete results
   */
  async execute(_input: TestIOTaskInput, _context: IExecuteContext): Promise<TestIOTaskOutput> {
    return { all: true, key: "full", reactiveOnly: false };
  }
}

// Define test types for more complex task implementations
/**
 * Input type for processing string values
 */
type SimpleProcessingInput = {
  value: string;
};

/**
 * Output type for processed string values with a status flag
 */
type SimpleProcessingOutput = {
  processed: boolean;
  result: string;
};

/**
 * A more complex test task implementation that demonstrates
 * progress reporting and error simulation capabilities
 */
export class SimpleProcessingTask extends Task<SimpleProcessingInput, SimpleProcessingOutput> {
  static readonly type = "SimpleProcessingTask";

  // Define input schema
  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        value: {
          type: "string",
          description: "Input value to process",
          default: "default",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  // Define output schema
  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        processed: {
          type: "boolean",
          description: "Flag indicating if the value was processed",
        },
        result: {
          type: "string",
          description: "Processed result value",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  /**
   * Full implementation for processing input values
   * Demonstrates progress reporting
   */
  async execute(
    input: SimpleProcessingInput,
    { updateProgress }: IExecuteContext
  ): Promise<SimpleProcessingOutput> {
    await updateProgress(0.5);
    // Process the input value
    const result = `Processed: ${input.value}`;
    return { processed: true, result };
  }

  /**
   * Reactive implementation for real-time feedback
   */
  async executeReactive(input: SimpleProcessingInput, output: SimpleProcessingOutput) {
    // For testing purposes, just return a different result
    return { processed: output.processed ?? false, result: `Reactive: ${input.value}` };
  }
}

// Constants for standard error messages
export const FAILURE_MESSAGE = "Task failed intentionally" as const;
export const ABORT_MESSAGE = "Task aborted intentionally" as const;

/**
 * A task that always fails - useful for testing error handling
 * and recovery mechanisms in the task system
 */
export class FailingTask extends Task {
  static readonly type = "FailingTask";
  declare runInputData: { in: number };
  declare runOutputData: { out: number };

  // Define input schema
  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        in: {
          type: "number",
          description: "Input number",
          default: 0,
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  // Define output schema
  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        out: {
          type: "number",
          description: "Output number",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  /**
   * Always throws an error to simulate task failure
   */
  async execute(input: TaskInput, executeContext: IExecuteContext): Promise<{ out: number }> {
    // Add a small delay to ensure abortion has time to take effect
    await sleep(5);
    if (executeContext.signal?.aborted) {
      throw new TaskAbortedError(ABORT_MESSAGE);
    }
    throw new TaskFailedError(FAILURE_MESSAGE);
  }
}

/**
 * Test task with configurable behavior for testing event handling,
 * progress reporting, and error conditions
 */
export class EventTestTask extends Task<TestIOTaskInput, TestIOTaskOutput> {
  static readonly type = "EventTestTask";

  // Control flags for testing different behaviors
  shouldThrowError = false;
  shouldEmitProgress = false;
  progressValue = 0.5;
  delayMs = 0;

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        key: {
          type: "string",
          default: "default",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        reactiveOnly: {
          type: "boolean",
        },
        all: {
          type: "boolean",
        },
        key: {
          type: "string",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  /**
   * Executes the task with configurable behavior for testing
   */
  async execute(input: TestIOTaskInput, { updateProgress, signal }: IExecuteContext): Promise<any> {
    if (signal.aborted) {
      throw new TaskAbortedError("Task aborted");
    }

    if (this.shouldEmitProgress) {
      updateProgress(this.progressValue);
    }

    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    if (signal.aborted) {
      throw new TaskAbortedError("Task aborted");
    }

    if (this.shouldThrowError) {
      throw new TaskError("Test error");
    }

    return {
      reactiveOnly: false,
      all: true,
      key: input.key,
    };
  }
}

/**
 * Input type for squaring a number
 */
export type TestSquareTaskInput = {
  input: number;
};

/**
 * Output type for squared number
 */
export type TestSquareTaskOutput = {
  output: number;
};

/**
 * Task that squares its input number
 */
export class TestSquareTask extends Task<TestSquareTaskInput, TestSquareTaskOutput> {
  static readonly type = "TestSquareTask";

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: {
          type: "number",
          description: "Number to square",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: {
          type: "number",
          description: "Squared number",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  /**
   * Reactive implementation that squares the input number
   */
  async executeReactive(input: TestSquareTaskInput): Promise<TestSquareTaskOutput> {
    return {
      output: input.input * input.input,
    };
  }
}

/**
 * Non-reactive version of TestSquareTask
 * Only implements execute() for testing differences between reactive and non-reactive tasks
 */
export class TestSquareNonReactiveTask extends Task<TestSquareTaskInput, TestSquareTaskOutput> {
  static readonly type = "TestSquareNonReactiveTask";

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: {
          type: "number",
          description: "Number to square",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: {
          type: "number",
          description: "Squared number",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  /**
   * Non-reactive implementation that squares the input number
   */
  async execute(input: TestSquareTaskInput): Promise<TestSquareTaskOutput> {
    return { output: input.input * input.input };
  }
}

/**
 * Input type for doubling a number
 */
export type TestDoubleTaskInput = {
  input: number;
};

/**
 * Output type for doubled number
 */
export type TestDoubleTaskOutput = {
  output: number;
};

/**
 * Task that doubles its input number
 */
export class TestDoubleTask extends Task<TestDoubleTaskInput, TestDoubleTaskOutput> {
  static readonly type = "TestDoubleTask";

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: {
          type: "number",
          description: "Number to double",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: {
          type: "number",
          description: "Doubled number",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  /**
   * Reactive implementation that doubles the input number
   */
  async executeReactive(input: TestDoubleTaskInput): Promise<TestDoubleTaskOutput> {
    return {
      output: input.input * 2,
    };
  }
}

/**
 * Task that throws errors under specific conditions
 * Used for testing error handling in the task system
 */
export class TestSquareErrorTask extends Task<TestSquareTaskInput, TestSquareTaskOutput> {
  static readonly type = "TestSquareErrorTask";

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: {
          type: "number",
          description: "Number to square (will throw error)",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: {
          type: "number",
          description: "Squared number (never returned due to error)",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  /**
   * Always throws an error to test error handling
   */
  async executeReactive(input: TestSquareTaskInput): Promise<TestSquareTaskOutput> {
    throw new TaskError("Test error");
  }
}

/**
 * Simple single task
 */
export class TestSimpleTask extends Task<{ input: string }, { output: string }> {
  static type = "TestSimpleTask";

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: {
          type: "string",
          description: "Input string",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: {
          type: "string",
          description: "Output string",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(input: { input: string }): Promise<{ output: string }> {
    return { output: `processed-${input.input}` };
  }
}

/**
 * Task that uses a custom output property name
 */
export class TestOutputTask extends Task<{ input: string }, { customOutput: string }> {
  static type = "TestOutputTask";
  declare runInputData: { input: string };
  declare runOutputData: { customOutput: string };

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: {
          type: "string",
          description: "Input string",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        customOutput: {
          type: "string",
          description: "Custom output string",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  /**
   * Returns the input in a custom output property
   */
  async execute(input: TaskInput): Promise<any> {
    return { customOutput: (input as { input: string }).input };
  }
}

/**
 * Task that uses a custom input property name
 */
export class TestInputTask extends Task<{ customInput: string }, { output: string }> {
  static type = "TestInputTask";
  declare runInputData: { customInput: string };
  declare runOutputData: { output: string };

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        customInput: {
          type: "string",
          description: "Custom input string",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: {
          type: "string",
          description: "Output string",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  /**
   * Returns the custom input in the output property
   */
  async execute(input: TaskInput): Promise<any> {
    return { output: (input as { customInput: string }).customInput };
  }
}

/**
 * Task that runs for a long time to test task abortion
 */
export class LongRunningTask extends Task {
  static type = "LongRunningTask";

  /**
   * Runs indefinitely until aborted
   */
  async execute(input: TaskInput, executeContext: IExecuteContext): Promise<any> {
    while (true) {
      if (executeContext.signal?.aborted) {
        throw new TaskAbortedError(ABORT_MESSAGE);
      }
      await sleep(100);
    }
  }
}

/**
 * Task that copies string input
 */
export class StringTask extends Task<{ input: string }, { output: string }, TaskConfig> {
  static type = "StringTask";

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: {
          type: "string",
          description: "Input string",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: {
          type: "string",
          description: "Output string",
        },
      },
    } as const satisfies DataPortSchema;
  }

  /**
   * Returns the input string as output
   */
  async executeReactive(
    input: { input: string },
    _output: { output: string }
  ): Promise<{ output: string }> {
    return { output: input.input };
  }
}

/**
 * Task that copies string input
 */
export class NumberToStringTask extends Task<{ input: number }, { output: string }, TaskConfig> {
  static type = "NumberToStringTask";

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: {
          type: "number",
          description: "Input number",
        },
      },
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: {
          type: "string",
          description: "Output string",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  /**
   * Returns the input string as output
   */
  async execute(input: { input: number }, _context: IExecuteContext): Promise<{ output: string }> {
    return { output: String(input.input) };
  }
}

/**
 * Task that processes number input
 */
export class NumberTask extends Task<{ input: number }, { output: number }, TaskConfig> {
  static type = "NumberTask";

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: {
          type: "number",
          description: "Input number",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: {
          type: "number",
          description: "Output number",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  /**
   * Returns the input number as output
   */
  async execute(input: { input: number }, _context: IExecuteContext): Promise<{ output: number }> {
    return { output: input.input };
  }
}

/**
 * Input type for adding two numbers
 */
type TestAddTaskInput = {
  a: number;
  b: number;
};

/**
 * Output type for sum of two numbers
 */
type TestAddTaskOutput = {
  output: number;
};

/**
 * Task that adds two numbers
 */
export class TestAddTask extends Task<TestAddTaskInput, TestAddTaskOutput> {
  static readonly type = "TestAddTask";

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        a: {
          type: "number",
          description: "First number",
        },
        b: {
          type: "number",
          description: "Second number",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: {
          type: "number",
          description: "Sum of a and b",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  /**
   * Adds the two input numbers
   */
  async executeReactive(input: TestAddTaskInput) {
    return {
      output: input.a + input.b,
    };
  }
}

/**
 * Task that outputs a TypedArray with port name "vector" (singular)
 * Used for testing type-only matching with different port names
 */
export class VectorOutputTask extends Task<{ text: string }, { vector: Float32Array }> {
  static type = "VectorOutputTask";

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Input text",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        vector: {
          type: "array",
          format: "TypedArray",
          title: "Vector",
          description: "Output vector (singular name)",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(input: { text: string }): Promise<{ vector: Float32Array }> {
    return { vector: new Float32Array([0.1, 0.2, 0.3]) };
  }
}

/**
 * Task that accepts a TypedArray with port name "vectors" (plural)
 * Used for testing type-only matching with different port names
 */
export class VectorsInputTask extends Task<{ vectors: Float32Array }, { count: number }> {
  static type = "VectorsInputTask";

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        vectors: {
          type: "array",
          format: "TypedArray",
          title: "Vectors",
          description: "Input vectors (plural name)",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        count: {
          type: "number",
          description: "Length of the vector",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(input: { vectors: Float32Array }): Promise<{ count: number }> {
    return { count: input.vectors.length };
  }
}

/**
 * Task that outputs a TypedArray wrapped in oneOf (like TypeSingleOrArray)
 */
export class VectorOneOfOutputTask extends Task<{ text: string }, { embedding: Float32Array }> {
  static type = "VectorOneOfOutputTask";

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Input text",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        embedding: {
          oneOf: [
            {
              type: "array",
              format: "TypedArray",
              title: "Single Embedding",
            },
            {
              type: "array",
              items: {
                type: "array",
                format: "TypedArray",
              },
              title: "Multiple Embeddings",
            },
          ],
          title: "Embedding",
          description: "Output embedding (oneOf wrapper)",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(input: { text: string }): Promise<{ embedding: Float32Array }> {
    return { embedding: new Float32Array([0.4, 0.5, 0.6]) };
  }
}

/**
 * Task that accepts a TypedArray wrapped in anyOf
 */
export class VectorAnyOfInputTask extends Task<{ data: Float32Array }, { sum: number }> {
  static type = "VectorAnyOfInputTask";

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        data: {
          anyOf: [
            {
              type: "array",
              format: "TypedArray",
              title: "Single Vector",
            },
            {
              type: "array",
              items: {
                type: "array",
                format: "TypedArray",
              },
              title: "Multiple Vectors",
            },
          ],
          title: "Data",
          description: "Input data (anyOf wrapper)",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        sum: {
          type: "number",
          description: "Sum of vector elements",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(input: { data: Float32Array }): Promise<{ sum: number }> {
    return { sum: Array.from(input.data).reduce((a, b) => a + b, 0) };
  }
}

/**
 * Module augmentation to register test task types in the workflow system
 */
declare module "@workglow/task-graph" {
  interface Workflow {
    testSimple(input?: Partial<{ input: string }>, config?: Partial<TaskConfig>): this;
    testOutput(input?: Partial<{ input: string }>, config?: Partial<TaskConfig>): this;
    testInput(input?: Partial<{ customInput: string }>, config?: Partial<TaskConfig>): this;
    failing(input?: Partial<{}>, config?: Partial<TaskConfig>): this;
    longRunning(input?: Partial<{}>, config?: Partial<TaskConfig>): this;
    string(input?: Partial<{ input: string }>, config?: Partial<TaskConfig>): this;
    numberToString(input?: Partial<{ input: number }>, config?: Partial<TaskConfig>): this;
    number(input?: Partial<{ input: number }>, config?: Partial<TaskConfig>): this;
    testAdd(input?: Partial<TestAddTaskInput>, config?: Partial<TaskConfig>): this;
    vectorOutput(input?: Partial<{ text: string }>, config?: Partial<TaskConfig>): this;
    vectorsInput(input?: Partial<{ vectors: Float32Array }>, config?: Partial<TaskConfig>): this;
    vectorOneOfOutput(input?: Partial<{ text: string }>, config?: Partial<TaskConfig>): this;
    vectorAnyOfInput(input?: Partial<{ data: Float32Array }>, config?: Partial<TaskConfig>): this;
    textOutput(input?: Partial<{ input: string }>, config?: Partial<TaskConfig>): this;
    vectorOutputOnly(input?: Partial<{ size: number }>, config?: Partial<TaskConfig>): this;
    textVectorInput(
      input?: Partial<{ text: string; vector: Float32Array }>,
      config?: Partial<TaskConfig>
    ): this;
    passthroughVector(
      input?: Partial<{ vector: Float32Array }>,
      config?: Partial<TaskConfig>
    ): this;
  }
}

// Register test tasks with the workflow system
Workflow.prototype.testSimple = CreateWorkflow(TestSimpleTask);
Workflow.prototype.testOutput = CreateWorkflow(TestOutputTask);
Workflow.prototype.testInput = CreateWorkflow(TestInputTask);
Workflow.prototype.failing = CreateWorkflow(FailingTask);
Workflow.prototype.longRunning = CreateWorkflow(LongRunningTask);
Workflow.prototype.string = CreateWorkflow(StringTask);
Workflow.prototype.numberToString = CreateWorkflow(NumberToStringTask);
Workflow.prototype.number = CreateWorkflow(NumberTask);
Workflow.prototype.testAdd = CreateWorkflow(TestAddTask);
Workflow.prototype.vectorOutput = CreateWorkflow(VectorOutputTask);
Workflow.prototype.vectorsInput = CreateWorkflow(VectorsInputTask);
Workflow.prototype.vectorOneOfOutput = CreateWorkflow(VectorOneOfOutputTask);
Workflow.prototype.vectorAnyOfInput = CreateWorkflow(VectorAnyOfInputTask);
/**
 * Task that outputs only text - for testing multi-source matching
 */
export class TextOutputTask extends Task<{ input: string }, { text: string }> {
  static type = "TextOutputTask";

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: {
          type: "string",
          description: "Input string",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Output text",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(input: { input: string }): Promise<{ text: string }> {
    return { text: input.input };
  }
}

/**
 * Task that outputs only a vector - for testing multi-source matching
 */
export class VectorOutputOnlyTask extends Task<{ size: number }, { vector: Float32Array }> {
  static type = "VectorOutputOnlyTask";

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        size: {
          type: "number",
          description: "Vector size",
          default: 3,
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        vector: {
          type: "array",
          format: "TypedArray",
          title: "Vector",
          description: "Output vector",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(input: { size: number }): Promise<{ vector: Float32Array }> {
    return { vector: new Float32Array(input.size || 3).fill(1.0) };
  }
}

/**
 * Task that requires both text and vector inputs - for testing multi-source matching
 */
export class TextVectorInputTask extends Task<
  { text: string; vector: Float32Array },
  { result: string }
> {
  static type = "TextVectorInputTask";

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Input text",
        },
        vector: {
          type: "array",
          items: { type: "number" },
          format: "TypedArray",
          title: "Vector",
          description: "Input vector",
        },
      },
      required: ["text", "vector"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        result: {
          type: "string",
          description: "Combined result",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(input: { text: string; vector: Float32Array }): Promise<{ result: string }> {
    return { result: `${input.text} with vector of length ${input.vector.length}` };
  }
}

/**
 * Task that passes through a vector - for testing multi-hop matching
 */
export class PassthroughVectorTask extends Task<
  { vector: Float32Array },
  { vector: Float32Array }
> {
  static type = "PassthroughVectorTask";

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        vector: {
          type: "array",
          format: "TypedArray",
          title: "Vector",
          description: "Input vector",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        vector: {
          type: "array",
          format: "TypedArray",
          title: "Vector",
          description: "Output vector (passthrough)",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(input: { vector: Float32Array }): Promise<{ vector: Float32Array }> {
    return { vector: input.vector };
  }
}
Workflow.prototype.textOutput = CreateWorkflow(TextOutputTask);
Workflow.prototype.vectorOutputOnly = CreateWorkflow(VectorOutputOnlyTask);
Workflow.prototype.textVectorInput = CreateWorkflow(TextVectorInputTask);
Workflow.prototype.passthroughVector = CreateWorkflow(PassthroughVectorTask);
