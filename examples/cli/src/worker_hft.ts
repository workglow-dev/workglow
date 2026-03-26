/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  setHftCacheDir,
  registerHuggingFaceTransformersWorker,
  loadTransformersSDK,
} from "@workglow/ai-provider/hf-transformers/runtime";

if (process.env.WORKGLOW_MODEL_CACHE) {
  setHftCacheDir(process.env.WORKGLOW_MODEL_CACHE);
}

registerHuggingFaceTransformersWorker();
