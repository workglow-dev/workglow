/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Node.js/Bun entry point for @workglow/browser-automation.
 * Registers all browser tasks and exports everything.
 */

import { registerBrowserTasks } from "./common";

// Eagerly register tasks at module load time
registerBrowserTasks();

export * from "./common";
