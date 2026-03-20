/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { env } from "@huggingface/transformers";
import {
  registerHuggingFaceTransformersWorker,
  setHftCacheDir,
} from "@workglow/ai-provider/hf-transformers";

env.backends!.onnx!.wasm!.proxy = true;

if (process.env.WORKGLOW_MODEL_CACHE) {
  setHftCacheDir(process.env.WORKGLOW_MODEL_CACHE);
}

registerHuggingFaceTransformersWorker();
