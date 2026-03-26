/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConsoleLogger, ILogger, NullLogger } from "@workglow/util";

function getEnv(name: string): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    return process.env[name];
  }
  return import.meta.env[name];
}

function isTruthy(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}

function isActionsDebug(): boolean {
  return isTruthy(getEnv("RUNNER_DEBUG")) || isTruthy(getEnv("ACTIONS_STEP_DEBUG"));
}

let testingLogger: ILogger = isActionsDebug()
  ? new ConsoleLogger({ level: "debug" })
  : new NullLogger();

export function setTestingLogger(logger: ILogger): void {
  testingLogger = logger;
}

export function getTestingLogger(): ILogger {
  return testingLogger;
}
