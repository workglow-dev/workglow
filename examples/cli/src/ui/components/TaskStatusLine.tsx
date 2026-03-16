/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { Text } from "ink";

interface TaskStatusLineProps {
  readonly type: string;
  readonly status: string;
  readonly progress?: number;
  readonly message?: string;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: "gray",
  PROCESSING: "yellow",
  COMPLETED: "green",
  FAILED: "red",
  ABORTED: "red",
};

export function TaskStatusLine({
  type,
  status,
  progress,
  message,
}: TaskStatusLineProps): React.ReactElement {
  const color = STATUS_COLORS[status] ?? "white";
  const progressText = progress !== undefined ? ` ${Math.round(progress)}%` : "";
  const msgText = message ? ` — ${message}` : "";

  return (
    <Text>
      <Text color={color}>[{status}]</Text> {type}{progressText}{msgText}
    </Text>
  );
}
