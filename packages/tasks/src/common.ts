/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// Load adaptive first so Workflow.prototype.add/subtract/multiply/divide/sum are registered
import "./task/adaptive";

export * from "./util/SafeFetch";
export * from "./util/UrlClassifier";
export * from "./mcp-server/getMcpServerConfig";
export * from "./mcp-server/InMemoryMcpServerRepository";
export * from "./mcp-server/McpServerRegistry";
export * from "./mcp-server/McpServerRepository";
export * from "./mcp-server/McpServerSchema";
export * from "./task/adaptive";
export * from "./task/ArrayTask";
export * from "./task/DateFormatTask";
export * from "./task/DebugLogTask";
export * from "./task/DelayTask";
export * from "./task/FetchUrlTask";
export * from "./task/HumanApprovalTask";
export * from "./task/HumanInputTask";
export * from "./task/image/ImageBlurTask";
export * from "./task/image/ImageBorderTask";
export * from "./task/image/ImageBrightnessTask";
export * from "./task/image/ImageContrastTask";
export * from "./task/image/ImageCropTask";
export * from "./task/image/ImageFlipTask";
export * from "./task/image/ImageGrayscaleTask";
export * from "./task/image/ImageInvertTask";
export * from "./task/image/ImagePixelateTask";
export * from "./task/image/ImagePosterizeTask";
export * from "./task/image/imageCodecLimits";
export * from "./task/image/imageRasterCodecRegistry";
export * from "./task/image/ImageResizeTask";
export * from "./task/image/ImageRotateTask";
export * from "./task/image/ImageSchemas";
export * from "./task/image/ImageSepiaTask";
export * from "./task/image/imageTaskIo";
export * from "./task/image/imageTaskTransport";
export * from "./task/image/ImageTextTask";
export * from "./task/image/ImageThresholdTask";
export * from "./task/image/ImageTintTask";
export * from "./task/image/ImageTransparencyTask";
export * from "./task/image/ImageWatermarkTask";
export * from "./task/InputTask";
export * from "./task/JavaScriptTask";
export * from "./task/JsonPathTask";
export * from "./task/JsonTask";
export * from "./task/LambdaTask";
export * from "./task/mcp/McpListTask";
export * from "./task/mcp/McpPromptGetTask";
export * from "./task/mcp/McpResourceReadTask";
export * from "./task/mcp/McpSearchTask";
export * from "./task/mcp/McpToolCallTask";
export * from "./task/McpElicitationConnector";
export * from "./task/MergeTask";
export * from "./task/OutputTask";
export * from "./task/RegexTask";
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
export * from "./task/SplitTask";
export * from "./task/string/StringConcatTask";
export * from "./task/string/StringIncludesTask";
export * from "./task/string/StringJoinTask";
export * from "./task/string/StringLengthTask";
export * from "./task/string/StringLowerCaseTask";
export * from "./task/string/StringReplaceTask";
export * from "./task/string/StringSliceTask";
export * from "./task/string/StringTemplateTask";
export * from "./task/string/StringTrimTask";
export * from "./task/string/StringUpperCaseTask";
export * from "./task/TemplateTask";
export * from "./task/vector/VectorDistanceTask";
export * from "./task/vector/VectorDivideTask";
export * from "./task/vector/VectorDotProductTask";
export * from "./task/vector/VectorMultiplyTask";
export * from "./task/vector/VectorNormalizeTask";
export * from "./task/vector/VectorScaleTask";
export * from "./task/vector/VectorSubtractTask";
export * from "./task/vector/VectorSumTask";

import { TaskRegistry } from "@workglow/task-graph";
import { DateFormatTask } from "./task/DateFormatTask";
import { DebugLogTask } from "./task/DebugLogTask";
import { DelayTask } from "./task/DelayTask";
import { FetchUrlTask } from "./task/FetchUrlTask";
import { HumanApprovalTask } from "./task/HumanApprovalTask";
import { HumanInputTask } from "./task/HumanInputTask";
import { ImageBlurTask } from "./task/image/ImageBlurTask";
import { ImageBorderTask } from "./task/image/ImageBorderTask";
import { ImageBrightnessTask } from "./task/image/ImageBrightnessTask";
import { ImageContrastTask } from "./task/image/ImageContrastTask";
import { ImageCropTask } from "./task/image/ImageCropTask";
import { ImageFlipTask } from "./task/image/ImageFlipTask";
import { ImageGrayscaleTask } from "./task/image/ImageGrayscaleTask";
import { ImageInvertTask } from "./task/image/ImageInvertTask";
import { ImagePixelateTask } from "./task/image/ImagePixelateTask";
import { ImagePosterizeTask } from "./task/image/ImagePosterizeTask";
import { ImageResizeTask } from "./task/image/ImageResizeTask";
import { ImageRotateTask } from "./task/image/ImageRotateTask";
import { ImageSepiaTask } from "./task/image/ImageSepiaTask";
import { ImageTextTask } from "./task/image/ImageTextTask";
import { ImageThresholdTask } from "./task/image/ImageThresholdTask";
import { ImageTintTask } from "./task/image/ImageTintTask";
import { ImageTransparencyTask } from "./task/image/ImageTransparencyTask";
import { ImageWatermarkTask } from "./task/image/ImageWatermarkTask";
import { InputTask } from "./task/InputTask";
import { JavaScriptTask } from "./task/JavaScriptTask";
import { JsonPathTask } from "./task/JsonPathTask";
import { JsonTask } from "./task/JsonTask";
import { LambdaTask } from "./task/LambdaTask";
import { McpListTask } from "./task/mcp/McpListTask";
import { McpPromptGetTask } from "./task/mcp/McpPromptGetTask";
import { McpResourceReadTask } from "./task/mcp/McpResourceReadTask";
import { McpSearchTask } from "./task/mcp/McpSearchTask";
import { McpToolCallTask } from "./task/mcp/McpToolCallTask";
import { MergeTask } from "./task/MergeTask";
import { OutputTask } from "./task/OutputTask";
import { RegexTask } from "./task/RegexTask";
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
import { SplitTask } from "./task/SplitTask";
import { StringConcatTask } from "./task/string/StringConcatTask";
import { StringIncludesTask } from "./task/string/StringIncludesTask";
import { StringJoinTask } from "./task/string/StringJoinTask";
import { StringLengthTask } from "./task/string/StringLengthTask";
import { StringLowerCaseTask } from "./task/string/StringLowerCaseTask";
import { StringReplaceTask } from "./task/string/StringReplaceTask";
import { StringSliceTask } from "./task/string/StringSliceTask";
import { StringTemplateTask } from "./task/string/StringTemplateTask";
import { StringTrimTask } from "./task/string/StringTrimTask";
import { StringUpperCaseTask } from "./task/string/StringUpperCaseTask";
import { TemplateTask } from "./task/TemplateTask";
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
export let registerCommonTasks = () => {
  const tasks = [
    DebugLogTask,
    DelayTask,
    FetchUrlTask,
    HumanApprovalTask,
    HumanInputTask,
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
    McpSearchTask,
    McpListTask,
    StringConcatTask,
    StringIncludesTask,
    StringJoinTask,
    StringLengthTask,
    StringLowerCaseTask,
    StringReplaceTask,
    StringSliceTask,
    StringTemplateTask,
    StringTrimTask,
    StringUpperCaseTask,
    JsonPathTask,
    TemplateTask,
    DateFormatTask,
    RegexTask,
    ImageResizeTask,
    ImageCropTask,
    ImageRotateTask,
    ImageFlipTask,
    ImageGrayscaleTask,
    ImageBorderTask,
    ImageTransparencyTask,
    ImageBlurTask,
    ImageWatermarkTask,
    ImagePixelateTask,
    ImageInvertTask,
    ImageBrightnessTask,
    ImageContrastTask,
    ImageSepiaTask,
    ImageThresholdTask,
    ImagePosterizeTask,
    ImageTintTask,
    ImageTextTask,
  ];
  tasks.map(TaskRegistry.registerTask);
  return tasks;
};
