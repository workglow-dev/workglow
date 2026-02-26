/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ILogger, NullLogger } from "@workglow/util";

let testingLogger: ILogger = new NullLogger();

export function setTestingLogger(logger: ILogger): void {
  testingLogger = logger;
}

export function getTestingLogger(): ILogger {
  return testingLogger;
}
