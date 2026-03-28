/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export {
  parseDynamicFlags,
  parseConfigFlags,
  generateSchemaHelpText,
  generateConfigHelpText,
} from "./schema-flags";
export {
  resolveInput,
  resolveConfig,
  validateInput,
  readJsonInput,
  applySchemaDefaults,
  deepMerge,
  type ResolveInputOptions,
  type ValidationResult,
} from "./resolve-input";
export { promptMissingInput, getMissingFields, type PromptFieldDescriptor } from "./prompt";
