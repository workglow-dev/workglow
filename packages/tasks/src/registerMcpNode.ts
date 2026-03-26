/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mcpClientFactory, mcpServerConfigSchema } from "./util/McpClientUtil.node";
import { registerMcpTaskDeps } from "./util/McpTaskDeps";

registerMcpTaskDeps({ mcpClientFactory, mcpServerConfigSchema });
