/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { DATAFLOW_ALL_PORTS, DATAFLOW_ERROR_PORT } from "./Dataflow";
import type { ITask } from "../task/ITask";
import type { TaskGraph } from "./TaskGraph";
import { Workflow } from "./Workflow";
import type { TaskIdType } from "../task/TaskTypes";

/**
 * Options controlling the generated workflow code.
 */
export interface GraphToWorkflowCodeOptions {
  /** Name of the workflow variable in the generated code. @default "workflow" */
  readonly variableName?: string;
  /** When true, include `new Workflow()` declaration. @default true */
  readonly includeDeclaration?: boolean;
  /** Indentation string per level. @default "  " */
  readonly indent?: string;
}

/**
 * Map from task type name to the Workflow prototype method name.
 * Built lazily by scanning `Workflow.prototype` for methods with `workflowCreate = true`.
 */
let methodNameCache: Map<string, string> | undefined;

function getMethodNameMap(): Map<string, string> {
  if (methodNameCache) return methodNameCache;
  methodNameCache = new Map<string, string>();
  for (const key of Object.getOwnPropertyNames(Workflow.prototype)) {
    try {
      const val = (Workflow.prototype as any)[key];
      if (val && val.workflowCreate && val.type) {
        methodNameCache.set(val.type, key);
      }
    } catch {
      // skip getters that throw
    }
  }
  return methodNameCache;
}

/**
 * Loop task types that use the builder pattern.
 */
const LOOP_TASK_TYPES: Record<string, { method: string; endMethod: string }> = {
  MapTask: { method: "map", endMethod: "endMap" },
  ReduceTask: { method: "reduce", endMethod: "endReduce" },
  WhileTask: { method: "while", endMethod: "endWhile" },
};

/**
 * Converts a TaskGraph into JavaScript/TypeScript code that builds an equivalent Workflow.
 *
 * This is the reverse of the Workflow builder: given a graph (with tasks, dataflows, and
 * potential subgraphs for loop/compound tasks), it produces code that re-creates the
 * same graph via the Workflow API.
 *
 * The generated code uses method chaining, which is critical for loop tasks where
 * `.map()` / `.while()` / `.reduce()` return a loop builder that inner tasks must
 * be called on before `.endMap()` / `.endWhile()` / `.endReduce()` returns to the
 * parent workflow.
 *
 * @param graph - The TaskGraph to convert
 * @param options - Options controlling output format
 * @returns Generated JavaScript code string
 */
export function graphToWorkflowCode(
  graph: TaskGraph,
  options: GraphToWorkflowCodeOptions = {}
): string {
  const { variableName = "workflow", includeDeclaration = true, indent = "  " } = options;

  const lines: string[] = [];

  if (includeDeclaration) {
    lines.push(`const ${variableName} = new Workflow();`);
  }

  const tasks = graph.topologicallySortedNodes();
  const dataflows = graph.getDataflows();

  // Build dataflow lookup: targetTaskId -> list of dataflows
  const incomingDataflows = new Map<TaskIdType, typeof dataflows>();
  for (const df of dataflows) {
    const list = incomingDataflows.get(df.targetTaskId) ?? [];
    list.push(df);
    incomingDataflows.set(df.targetTaskId, list);
  }

  // Track task order for determining which task is "previous"
  const taskOrder: TaskIdType[] = [];

  generateTaskChain(tasks, incomingDataflows, taskOrder, variableName, indent, 0, lines);

  return lines.join("\n");
}

/**
 * Generates the workflow code for a sequence of tasks, using chained method calls.
 *
 * For loop tasks, inner tasks are indented and chained on the loop builder.
 * The `.end*()` call returns to the parent workflow, so subsequent tasks
 * continue chaining on the parent variable.
 */
function generateTaskChain(
  tasks: readonly ITask[],
  incomingDataflows: Map<TaskIdType, ReturnType<TaskGraph["getDataflows"]>>,
  taskOrder: TaskIdType[],
  variableName: string,
  indent: string,
  depth: number,
  lines: string[]
): void {
  const prefix = indent.repeat(depth);

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const loopInfo = LOOP_TASK_TYPES[task.type];

    // Check for rename() calls needed before this task
    const renames = computeRenames(task, incomingDataflows, taskOrder);
    for (const rename of renames) {
      lines.push(
        `${prefix}${variableName}.rename(${formatValue(rename.source)}, ${formatValue(rename.target)});`
      );
    }

    if (loopInfo) {
      // Loop task with builder pattern - generates chained calls
      generateLoopTask(task, loopInfo, incomingDataflows, taskOrder, variableName, indent, depth, lines);
    } else {
      // Regular task
      generateRegularTask(task, variableName, prefix, lines);
    }

    taskOrder.push(task.id);
  }
}

/**
 * Generates code for a regular (non-loop) task.
 */
function generateRegularTask(
  task: ITask,
  variableName: string,
  prefix: string,
  lines: string[]
): void {
  const methodMap = getMethodNameMap();
  const methodName = methodMap.get(task.type);
  const defaults = task.defaults;
  const config = extractTaskConfig(task);

  if (methodName) {
    const args = buildMethodArgs(defaults, config);
    lines.push(`${prefix}${variableName}.${methodName}(${args});`);
  } else {
    const args = buildAddTaskArgs(task.type, defaults, config);
    lines.push(`${prefix}${variableName}.addTask(${args});`);
  }
}

/**
 * Generates code for a loop task (map/reduce/while) using builder pattern.
 *
 * Loop tasks use chained method calls:
 * ```
 * workflow
 *   .map({ config })
 *     .addTask(InnerTask)
 *   .endMap()
 * ```
 *
 * The `.map()` call returns a loop builder, inner tasks chain on that,
 * and `.endMap()` returns to the parent workflow. All of this is a single
 * chained expression to preserve the correct `this` context.
 */
function generateLoopTask(
  task: ITask,
  loopInfo: { method: string; endMethod: string },
  incomingDataflows: Map<TaskIdType, ReturnType<TaskGraph["getDataflows"]>>,
  taskOrder: TaskIdType[],
  variableName: string,
  indent: string,
  depth: number,
  lines: string[]
): void {
  const prefix = indent.repeat(depth);
  const innerPrefix = indent.repeat(depth + 1);
  const config = extractLoopConfig(task);
  const configStr = Object.keys(config).length > 0 ? formatValue(config) : "";

  // Start the chain: workflow\n  .map(config)
  lines.push(`${prefix}${variableName}`);
  lines.push(`${innerPrefix}.${loopInfo.method}(${configStr})`);

  // Generate inner tasks from subgraph as chained calls
  if (task.hasChildren()) {
    const subGraph = task.subGraph!;
    const innerTasks = subGraph.topologicallySortedNodes();
    const innerDataflows = subGraph.getDataflows();

    const innerIncoming = new Map<TaskIdType, typeof innerDataflows>();
    for (const df of innerDataflows) {
      const list = innerIncoming.get(df.targetTaskId) ?? [];
      list.push(df);
      innerIncoming.set(df.targetTaskId, list);
    }

    const innerOrder: TaskIdType[] = [];
    generateChainedInnerTasks(
      innerTasks,
      innerIncoming,
      innerOrder,
      indent,
      depth + 1,
      lines
    );
  }

  // End the chain: .endMap();
  lines.push(`${innerPrefix}.${loopInfo.endMethod}();`);
}

/**
 * Generates inner tasks as chained method calls (for loop builder bodies).
 * Each task becomes a `.methodName(args)` or `.addTask(Class, args)` continuation.
 * Nested loops generate recursive chained structures.
 */
function generateChainedInnerTasks(
  tasks: readonly ITask[],
  incomingDataflows: Map<TaskIdType, ReturnType<TaskGraph["getDataflows"]>>,
  taskOrder: TaskIdType[],
  indent: string,
  depth: number,
  lines: string[]
): void {
  const innerPrefix = indent.repeat(depth + 1);

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const loopInfo = LOOP_TASK_TYPES[task.type];

    // Check for rename
    const renames = computeRenames(task, incomingDataflows, taskOrder);
    for (const rename of renames) {
      lines.push(
        `${innerPrefix}.rename(${formatValue(rename.source)}, ${formatValue(rename.target)})`
      );
    }

    if (loopInfo) {
      // Nested loop task - recurse
      const config = extractLoopConfig(task);
      const configStr = Object.keys(config).length > 0 ? formatValue(config) : "";
      const nestedPrefix = indent.repeat(depth + 2);

      lines.push(`${innerPrefix}.${loopInfo.method}(${configStr})`);

      if (task.hasChildren()) {
        const subGraph = task.subGraph!;
        const innerTasks = subGraph.topologicallySortedNodes();
        const innerDataflows = subGraph.getDataflows();

        const innerIncoming = new Map<TaskIdType, typeof innerDataflows>();
        for (const df of innerDataflows) {
          const list = innerIncoming.get(df.targetTaskId) ?? [];
          list.push(df);
          innerIncoming.set(df.targetTaskId, list);
        }

        const innerOrder: TaskIdType[] = [];
        generateChainedInnerTasks(innerTasks, innerIncoming, innerOrder, indent, depth + 1, lines);
      }

      lines.push(`${nestedPrefix}.${loopInfo.endMethod}()`);
    } else {
      // Regular inner task - chained call
      const methodMap = getMethodNameMap();
      const methodName = methodMap.get(task.type);
      const defaults = task.defaults;
      const config = extractTaskConfig(task);

      if (methodName) {
        const args = buildMethodArgs(defaults, config);
        lines.push(`${innerPrefix}.${methodName}(${args})`);
      } else {
        const args = buildAddTaskArgs(task.type, defaults, config);
        lines.push(`${innerPrefix}.addTask(${args})`);
      }
    }

    taskOrder.push(task.id);
  }
}

/**
 * Determines which dataflows need explicit `.rename()` calls.
 *
 * A rename is needed when a dataflow connects different port names between
 * the immediately previous task and the current task. Connections with matching
 * names are handled automatically by the Workflow's auto-connect system.
 */
function computeRenames(
  task: ITask,
  incomingDataflows: Map<TaskIdType, ReturnType<TaskGraph["getDataflows"]>>,
  taskOrder: TaskIdType[]
): Array<{ source: string; target: string }> {
  const incoming = incomingDataflows.get(task.id) ?? [];
  const renames: Array<{ source: string; target: string }> = [];

  const prevTaskId = taskOrder.length > 0 ? taskOrder[taskOrder.length - 1] : undefined;

  for (const df of incoming) {
    // Skip all-ports connections (auto-connected by pipe/addTask)
    if (df.sourceTaskPortId === DATAFLOW_ALL_PORTS && df.targetTaskPortId === DATAFLOW_ALL_PORTS) {
      continue;
    }

    // Skip error port connections
    if (
      df.sourceTaskPortId === DATAFLOW_ERROR_PORT ||
      df.targetTaskPortId === DATAFLOW_ERROR_PORT
    ) {
      continue;
    }

    // Only the immediately previous task can produce a rename
    if (df.sourceTaskId !== prevTaskId) {
      continue;
    }

    // If port names match, auto-connect handles it
    if (df.sourceTaskPortId === df.targetTaskPortId) {
      continue;
    }

    renames.push({ source: df.sourceTaskPortId, target: df.targetTaskPortId });
  }

  return renames;
}

/**
 * Extracts non-default config properties from a task for regular tasks.
 */
function extractTaskConfig(task: ITask): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  const rawConfig = task.config;
  if (rawConfig.title) config.title = rawConfig.title;
  if (rawConfig.description) config.description = rawConfig.description;
  if (rawConfig.extras && Object.keys(rawConfig.extras).length > 0) {
    config.extras = rawConfig.extras;
  }
  return config;
}

/**
 * Extracts config for loop tasks (map/reduce/while).
 */
function extractLoopConfig(task: ITask): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  const rawConfig = task.config as Record<string, unknown>;

  switch (task.type) {
    case "MapTask": {
      if (rawConfig.preserveOrder !== undefined && rawConfig.preserveOrder !== true) {
        config.preserveOrder = rawConfig.preserveOrder;
      }
      if (rawConfig.flatten !== undefined && rawConfig.flatten !== false) {
        config.flatten = rawConfig.flatten;
      }
      if (rawConfig.concurrencyLimit !== undefined) {
        config.concurrencyLimit = rawConfig.concurrencyLimit;
      }
      if (rawConfig.batchSize !== undefined) {
        config.batchSize = rawConfig.batchSize;
      }
      break;
    }
    case "ReduceTask": {
      if (rawConfig.initialValue !== undefined) {
        config.initialValue = rawConfig.initialValue;
      }
      break;
    }
    case "WhileTask": {
      if (rawConfig.maxIterations !== undefined && rawConfig.maxIterations !== 100) {
        config.maxIterations = rawConfig.maxIterations;
      }
      if (rawConfig.chainIterations !== undefined && rawConfig.chainIterations !== true) {
        config.chainIterations = rawConfig.chainIterations;
      }
      // Emit serializable condition form
      if (rawConfig.conditionField !== undefined) {
        config.conditionField = rawConfig.conditionField;
      }
      if (rawConfig.conditionOperator !== undefined) {
        config.conditionOperator = rawConfig.conditionOperator;
      }
      if (rawConfig.conditionValue !== undefined) {
        config.conditionValue = rawConfig.conditionValue;
      }
      // If there's a function condition but no serializable form, add a comment marker
      if (rawConfig.condition && !rawConfig.conditionOperator) {
        config.condition = "__CONDITION_FUNCTION__";
      }
      break;
    }
  }

  return config;
}

/**
 * Builds the argument string for a prototype method call.
 */
function buildMethodArgs(
  defaults: Record<string, unknown> | undefined,
  config: Record<string, unknown>
): string {
  const hasDefaults = defaults && Object.keys(defaults).length > 0;
  const hasConfig = Object.keys(config).length > 0;

  if (!hasDefaults && !hasConfig) return "";
  if (hasDefaults && !hasConfig) return formatValue(defaults);
  if (!hasDefaults && hasConfig) return `{}, ${formatValue(config)}`;
  return `${formatValue(defaults)}, ${formatValue(config)}`;
}

/**
 * Builds the argument string for an addTask() call.
 */
function buildAddTaskArgs(
  taskType: string,
  defaults: Record<string, unknown> | undefined,
  config: Record<string, unknown>
): string {
  const hasDefaults = defaults && Object.keys(defaults).length > 0;
  const hasConfig = Object.keys(config).length > 0;

  if (!hasDefaults && !hasConfig) return taskType;
  if (hasDefaults && !hasConfig) return `${taskType}, ${formatValue(defaults)}`;
  if (!hasDefaults && hasConfig) return `${taskType}, {}, ${formatValue(config)}`;
  return `${taskType}, ${formatValue(defaults)}, ${formatValue(config)}`;
}

/**
 * Formats a JavaScript value as a code string.
 * Handles objects, arrays, strings, numbers, booleans, undefined, null,
 * and special markers.
 */
export function formatValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") {
    if (value === "__CONDITION_FUNCTION__") {
      return "/* condition function - not serializable */";
    }
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Float32Array) {
    return `new Float32Array([${Array.from(value).join(", ")}])`;
  }
  if (value instanceof Float64Array) {
    return `new Float64Array([${Array.from(value).join(", ")}])`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((v) => formatValue(v));
    const oneLine = `[${items.join(", ")}]`;
    if (oneLine.length < 80) return oneLine;
    return `[\n${items.map((item) => `  ${item}`).join(",\n")}\n]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return "{}";
    const entries = keys.map((k) => {
      const formattedKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
      return `${formattedKey}: ${formatValue(obj[k])}`;
    });
    const oneLine = `{ ${entries.join(", ")} }`;
    if (oneLine.length < 80) return oneLine;
    return `{\n${entries.map((e) => `  ${e}`).join(",\n")}\n}`;
  }
  return String(value);
}

/**
 * Resets the method name cache. Useful for testing when prototype methods
 * are registered after initial import.
 */
export function resetMethodNameCache(): void {
  methodNameCache = undefined;
}
