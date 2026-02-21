/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskConfigurationError } from "@workglow/task-graph";

export type BrowserTypeName = "chromium" | "firefox" | "webkit";

export interface PlaywrightModule {
  chromium: { launch(options?: any): Promise<any> };
  firefox: { launch(options?: any): Promise<any> };
  webkit: { launch(options?: any): Promise<any> };
}

let _sdk: PlaywrightModule | undefined;

export async function loadPlaywright(): Promise<PlaywrightModule> {
  if (!_sdk) {
    try {
      // Optional peer dependency loaded lazily at runtime.
      // @ts-expect-error playwright may be absent in environments that do not use browser tasks.
      _sdk = (await import("playwright")) as PlaywrightModule;
    } catch (error) {
      throw new TaskConfigurationError(
        `Playwright is required for browser tasks but is not installed. Install it with 'bun add playwright' or 'npm i playwright'. (${String(error)})`
      );
    }
  }
  return _sdk;
}
