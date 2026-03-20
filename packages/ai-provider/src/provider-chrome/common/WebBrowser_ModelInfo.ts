/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelInfoTaskInput, ModelInfoTaskOutput } from "@workglow/ai";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

export const WebBrowser_ModelInfo: AiProviderRunFn<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  WebBrowserModelConfig
> = async (input) => {
  return {
    model: input.model,
    is_local: true,
    is_remote: false,
    supports_browser: true,
    supports_node: false,
    is_cached: false,
    is_loaded: false,
    file_sizes: null,
  };
};
