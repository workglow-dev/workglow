/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// Load adaptive first so Workflow.prototype.add/subtract/multiply/divide/sum are registered
import "./task/adaptive";

export {
  createMcpClient,
  mcpClientFactory,
  mcpServerConfigSchema,
  mcpTransportTypes,
  type McpServerConfig,
  type McpTransportType,
} from "@workglow/util";
export * from "./task/ArrayTask";
export * from "./task/DebugLogTask";
export * from "./task/DelayTask";
export * from "./task/FetchUrlTask";
export * from "./task/InputTask";
export * from "./task/JavaScriptTask";
export * from "./task/JsonTask";
export * from "./task/LambdaTask";
export * from "./task/MergeTask";
export * from "./task/OutputTask";
export * from "./task/SplitTask";
export * from "./task/adaptive";
export * from "./task/mcp/McpListTask";
export * from "./task/mcp/McpPromptGetTask";
export * from "./task/mcp/McpResourceReadTask";
export * from "./task/mcp/McpToolCallTask";
export * from "./task/scalar/ScalarAbsTask";
export * from "./task/scalar/ScalarAddTask";
export * from "./task/scalar/ScalarCeilTask";
export * from "./task/scalar/ScalarDivideTask";
export * from "./task/scalar/ScalarFloorTask";
export * from "./task/scalar/ScalarMaxTask";
export * from "./task/scalar/ScalarMinTask";
export * from "./task/scalar/ScalarMultiplyTask";
export * from "./task/scalar/ScalarRoundTask";
export * from "./task/scalar/ScalarSubtractTask";
export * from "./task/scalar/ScalarSumTask";
export * from "./task/scalar/ScalarTruncTask";
export * from "./task/vector/VectorDistanceTask";
export * from "./task/vector/VectorDivideTask";
export * from "./task/vector/VectorDotProductTask";
export * from "./task/vector/VectorMultiplyTask";
export * from "./task/vector/VectorNormalizeTask";
export * from "./task/vector/VectorScaleTask";
export * from "./task/vector/VectorSubtractTask";
export * from "./task/vector/VectorSumTask";

import { TaskRegistry } from "@workglow/task-graph";
import { DebugLogTask } from "./task/DebugLogTask";
import { DelayTask } from "./task/DelayTask";
import { FetchUrlTask } from "./task/FetchUrlTask";
import { InputTask } from "./task/InputTask";
import { JavaScriptTask } from "./task/JavaScriptTask";
import { JsonTask } from "./task/JsonTask";
import { LambdaTask } from "./task/LambdaTask";
import { MergeTask } from "./task/MergeTask";
import { OutputTask } from "./task/OutputTask";
import { SplitTask } from "./task/SplitTask";
import { McpListTask } from "./task/mcp/McpListTask";
import { McpPromptGetTask } from "./task/mcp/McpPromptGetTask";
import { McpResourceReadTask } from "./task/mcp/McpResourceReadTask";
import { McpToolCallTask } from "./task/mcp/McpToolCallTask";
import { ScalarAbsTask } from "./task/scalar/ScalarAbsTask";
import { ScalarAddTask } from "./task/scalar/ScalarAddTask";
import { ScalarCeilTask } from "./task/scalar/ScalarCeilTask";
import { ScalarDivideTask } from "./task/scalar/ScalarDivideTask";
import { ScalarFloorTask } from "./task/scalar/ScalarFloorTask";
import { ScalarMaxTask } from "./task/scalar/ScalarMaxTask";
import { ScalarMinTask } from "./task/scalar/ScalarMinTask";
import { ScalarMultiplyTask } from "./task/scalar/ScalarMultiplyTask";
import { ScalarRoundTask } from "./task/scalar/ScalarRoundTask";
import { ScalarSubtractTask } from "./task/scalar/ScalarSubtractTask";
import { ScalarSumTask } from "./task/scalar/ScalarSumTask";
import { ScalarTruncTask } from "./task/scalar/ScalarTruncTask";
import { VectorDistanceTask } from "./task/vector/VectorDistanceTask";
import { VectorDivideTask } from "./task/vector/VectorDivideTask";
import { VectorDotProductTask } from "./task/vector/VectorDotProductTask";
import { VectorMultiplyTask } from "./task/vector/VectorMultiplyTask";
import { VectorNormalizeTask } from "./task/vector/VectorNormalizeTask";
import { VectorScaleTask } from "./task/vector/VectorScaleTask";
import { VectorSubtractTask } from "./task/vector/VectorSubtractTask";
import { VectorSumTask } from "./task/vector/VectorSumTask";

// Register all common tasks with the TaskRegistry.
// Centralized registration ensures tasks are available for JSON deserialization
// and prevents tree-shaking issues.
export const registerCommonTasks = () => {
  const tasks = [
    DebugLogTask,
    DelayTask,
    FetchUrlTask,
    InputTask,
    JavaScriptTask,
    JsonTask,
    LambdaTask,
    MergeTask,
    OutputTask,
    SplitTask,
    ScalarAbsTask,
    ScalarAddTask,
    ScalarCeilTask,
    ScalarDivideTask,
    ScalarFloorTask,
    ScalarMaxTask,
    ScalarMinTask,
    ScalarMultiplyTask,
    ScalarRoundTask,
    ScalarSubtractTask,
    ScalarSumTask,
    ScalarTruncTask,
    VectorSumTask,
    VectorDistanceTask,
    VectorDivideTask,
    VectorDotProductTask,
    VectorMultiplyTask,
    VectorNormalizeTask,
    VectorScaleTask,
    VectorSubtractTask,
    McpToolCallTask,
    McpResourceReadTask,
    McpPromptGetTask,
    McpListTask,
  ];
  tasks.map(TaskRegistry.registerTask);
  return tasks;
};
