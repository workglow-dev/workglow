/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerImageTextRenderer } from "./imageTextRender";
import { createServerImageTextRenderer } from "./imageTextRender.server";

registerImageTextRenderer(createServerImageTextRenderer());
