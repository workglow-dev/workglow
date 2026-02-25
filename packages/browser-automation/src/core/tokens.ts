/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "@workglow/util";
import type { BrowserSessionManager } from "../session/BrowserSessionManager";
import type { RunCleanupRegistry } from "../session/RunCleanupRegistry";
import type { UnsafeExecutionPolicy } from "./types";

/**
 * Service token for the run-scoped browser session manager.
 */
export const BROWSER_SESSION_MANAGER = createServiceToken<BrowserSessionManager>(
  "browserAutomation.sessionManager"
);

/**
 * Service token for the run-scoped cleanup registry.
 */
export const RUN_CLEANUP_REGISTRY = createServiceToken<RunCleanupRegistry>(
  "browserAutomation.runCleanupRegistry"
);

/**
 * Service token for the unsafe execution policy gate.
 */
export const UNSAFE_EXEC_POLICY = createServiceToken<UnsafeExecutionPolicy>(
  "browserAutomation.unsafeExecPolicy"
);
