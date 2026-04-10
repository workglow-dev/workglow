/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createNodeImageRasterCodec } from "./imageRasterCodecNode";
import { registerImageRasterCodec } from "./imageRasterCodecRegistry";

registerImageRasterCodec(createNodeImageRasterCodec());
