/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerTensorFlowMediaPipeWorker } from "@workglow/tf-mediapipe/ai-runtime";

registerTensorFlowMediaPipeWorker().catch((error: unknown) => {
  console.error("Failed to register the MediaPipe worker:", error);
});
