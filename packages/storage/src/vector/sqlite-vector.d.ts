/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

declare module "@sqliteai/sqlite-vector" {
  /**
   * Returns the absolute path to the platform-specific native sqlite-vector
   * extension binary (.so, .dylib, or .dll).
   */
  export function getExtensionPath(): string;
}
