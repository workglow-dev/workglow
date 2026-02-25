/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// Re-export core types
export * from "./core";

// Re-export all task types and workflow extensions
export * from "./task/browser/BrowserNavigateTask";
export * from "./task/browser/BrowserClickTask";
export * from "./task/browser/BrowserTypeTask";
export * from "./task/browser/BrowserExtractTask";
export * from "./task/browser/BrowserWaitTask";
export * from "./task/browser/BrowserScreenshotTask";
export * from "./task/browser/BrowserCloseTask";
export * from "./task/browser/BrowserEvaluateTask";

// Re-export backend adapters
export {
  PlaywrightAdapter,
  assertSafeLaunchOptions,
  BLOCKED_LAUNCH_OPTION_KEYS,
} from "./backend/playwright/PlaywrightAdapter";
export { loadPlaywright } from "./backend/playwright/loadPlaywright";

import { TaskRegistry } from "@workglow/task-graph";
import { BrowserNavigateTask } from "./task/browser/BrowserNavigateTask";
import { BrowserClickTask } from "./task/browser/BrowserClickTask";
import { BrowserTypeTask } from "./task/browser/BrowserTypeTask";
import { BrowserExtractTask } from "./task/browser/BrowserExtractTask";
import { BrowserWaitTask } from "./task/browser/BrowserWaitTask";
import { BrowserScreenshotTask } from "./task/browser/BrowserScreenshotTask";
import { BrowserCloseTask } from "./task/browser/BrowserCloseTask";
import { BrowserEvaluateTask } from "./task/browser/BrowserEvaluateTask";

/**
 * Register all browser automation tasks with the TaskRegistry.
 * Centralized registration ensures tasks are available for JSON deserialization
 * and prevents tree-shaking issues.
 */
export const registerBrowserTasks = () => {
  const tasks = [
    BrowserNavigateTask,
    BrowserClickTask,
    BrowserTypeTask,
    BrowserExtractTask,
    BrowserWaitTask,
    BrowserScreenshotTask,
    BrowserCloseTask,
    BrowserEvaluateTask,
  ];
  tasks.map(TaskRegistry.registerTask);
  return tasks;
};
