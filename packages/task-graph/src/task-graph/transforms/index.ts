/**
 * @license Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TransformRegistry } from "../TransformRegistry";
import { pickTransform } from "./pick";
import { indexTransform } from "./index-access";
import { coalesceTransform } from "./coalesce";
import {
  uppercaseTransform,
  lowercaseTransform,
  truncateTransform,
  substringTransform,
} from "./string-casts";
import { unixToIsoDateTransform, isoDateToUnixTransform } from "./date-conversions";
import {
  numberToStringTransform,
  toBooleanTransform,
  stringifyTransform,
  parseJsonTransform,
} from "./scalar-conversions";

export {
  pickTransform,
  indexTransform,
  coalesceTransform,
  uppercaseTransform,
  lowercaseTransform,
  truncateTransform,
  substringTransform,
  unixToIsoDateTransform,
  isoDateToUnixTransform,
  numberToStringTransform,
  toBooleanTransform,
  stringifyTransform,
  parseJsonTransform,
};

/**
 * Registers all MVP built-in transforms. Separate from registerBaseTasks so
 * consumers can opt in independently (tests may want transforms without
 * task registration and vice versa).
 */
export function registerBuiltInTransforms(): void {
  const all = [
    pickTransform,
    indexTransform,
    coalesceTransform,
    uppercaseTransform,
    lowercaseTransform,
    truncateTransform,
    substringTransform,
    unixToIsoDateTransform,
    isoDateToUnixTransform,
    numberToStringTransform,
    toBooleanTransform,
    stringifyTransform,
    parseJsonTransform,
  ];
  for (const t of all) TransformRegistry.registerTransform(t);
}
