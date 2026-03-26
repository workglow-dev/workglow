/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchemaObject } from "@workglow/util/schema";

/**
 * Evaluate allOf if/then conditional rules against current input values.
 * Returns additional field names that are conditionally required.
 * Shared by interactive prompting and validateInput so behavior cannot drift.
 */
export function evaluateConditionalRequired(
  input: Record<string, unknown>,
  schema: DataPortSchemaObject
): string[] {
  const allOf = (schema as Record<string, unknown>).allOf;
  if (!Array.isArray(allOf)) return [];

  const additional: string[] = [];

  for (const rule of allOf) {
    if (typeof rule !== "object" || rule === null) continue;
    const { if: condition, then: consequence } = rule as {
      if?: Record<string, unknown>;
      then?: Record<string, unknown>;
    };
    if (!condition || !consequence) continue;

    const condProps = condition.properties as Record<string, unknown> | undefined;
    const condRequired = condition.required as string[] | undefined;
    if (!condProps) continue;

    let matches = true;
    for (const [key, constraint] of Object.entries(condProps)) {
      if (condRequired && !condRequired.includes(key)) continue;

      const inputValue = input[key];
      if (inputValue === undefined) {
        matches = false;
        break;
      }

      if (typeof constraint === "object" && constraint !== null && "const" in constraint) {
        if (inputValue !== (constraint as { const: unknown }).const) {
          matches = false;
          break;
        }
      }
    }

    if (matches) {
      const thenRequired = consequence.required;
      if (Array.isArray(thenRequired)) {
        additional.push(...thenRequired);
      }
    }
  }

  return additional;
}
