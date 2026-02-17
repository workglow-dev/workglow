/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { env } from "@sroussey/transformers";
import { HFT_WORKER_JOBRUN_REGISTER } from "@workglow/ai-provider/hf-transformers";

env.backends!.onnx!.wasm!.proxy = true;
HFT_WORKER_JOBRUN_REGISTER();
