/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bun entry point for @workglow/browser-automation.
 * Identical to the Node entry point.
 */

import { registerBrowserTasks } from "./common";

// Eagerly register tasks at module load time
registerBrowserTasks();

export * from "./common";
