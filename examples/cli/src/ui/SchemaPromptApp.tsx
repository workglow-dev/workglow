/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { Box, Text, Static } from "ink";
import { TextInput, Select, ConfirmInput } from "@inkjs/ui";
import type { PromptFieldDescriptor } from "../input/prompt";

interface SchemaPromptAppProps {
  readonly fields: readonly PromptFieldDescriptor[];
  readonly onComplete: (values: Record<string, unknown>) => void;
}

interface CompletedField {
  readonly id: number;
  readonly label: string;
  readonly value: string;
}

function setNestedValue(obj: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split(".");
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current) || typeof current[parts[i]] !== "object") {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}

function coercePromptValue(raw: string, field: PromptFieldDescriptor): unknown {
  switch (field.type) {
    case "number":
      return parseFloat(raw);
    case "integer":
      return parseInt(raw, 10);
    case "boolean":
      return raw === "true" || raw === "1";
    case "array":
      try {
        return JSON.parse(raw);
      } catch {
        return raw.split(",").map((s) => s.trim());
      }
    case "object":
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    case "enum":
    case "string":
    default:
      return raw;
  }
}

export function SchemaPromptApp({ fields, onComplete }: SchemaPromptAppProps): React.ReactElement {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [values] = useState<Record<string, unknown>>({});
  const [completedFields, setCompletedFields] = useState<CompletedField[]>([]);

  const handleSubmit = (raw: string, field: PromptFieldDescriptor): void => {
    const coerced = coercePromptValue(raw, field);
    setNestedValue(values, field.key, coerced);

    setCompletedFields((prev) => [
      ...prev,
      { id: prev.length, label: field.key, value: String(raw) },
    ]);

    const nextIndex = currentIndex + 1;
    if (nextIndex >= fields.length) {
      onComplete(values);
    } else {
      setCurrentIndex(nextIndex);
    }
  };

  const field = fields[currentIndex];

  return (
    <Box flexDirection="column">
      <Static items={completedFields}>
        {(item) => (
          <Text key={item.id} color="green">
            {"  \u2713 "}{item.label}: {item.value}
          </Text>
        )}
      </Static>

      {field && (
        <Box flexDirection="column">
          <Text dimColor>
            ({currentIndex + 1}/{fields.length})
          </Text>
          <Box>
            <Text bold>{field.label}</Text>
            <Text> </Text>
            <Text color="red">(required)</Text>
            {field.description && (
              <Text dimColor> — {field.description}</Text>
            )}
          </Box>
          <FieldWidget field={field} onSubmit={(raw) => handleSubmit(raw, field)} />
        </Box>
      )}
    </Box>
  );
}

interface FieldWidgetProps {
  readonly field: PromptFieldDescriptor;
  readonly onSubmit: (value: string) => void;
}

function FieldWidget({ field, onSubmit }: FieldWidgetProps): React.ReactElement {
  if (field.type === "enum" && field.enumValues) {
    const options = field.enumValues.map((v) => ({ label: v, value: v }));
    return <Select options={options} onChange={(value) => onSubmit(value)} />;
  }

  if (field.type === "boolean") {
    return (
      <Box>
        <Text dimColor>(y/n) </Text>
        <ConfirmInput
          onConfirm={() => onSubmit("true")}
          onCancel={() => onSubmit("false")}
        />
      </Box>
    );
  }

  const placeholder =
    field.type === "array"
      ? "JSON array or comma-separated"
      : field.type === "object"
        ? "JSON object"
        : undefined;

  return (
    <TextInput
      placeholder={placeholder}
      defaultValue={field.defaultValue !== undefined ? String(field.defaultValue) : undefined}
      onSubmit={onSubmit}
    />
  );
}
