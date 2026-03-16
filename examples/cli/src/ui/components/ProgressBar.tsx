/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { Text } from "ink";

interface ProgressBarProps {
  readonly progress: number;
  readonly width?: number;
}

export function ProgressBar({ progress, width = 30 }: ProgressBarProps): React.ReactElement {
  const clamped = Math.max(0, Math.min(100, progress));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  const bar = "=".repeat(filled) + (filled < width ? ">" : "") + " ".repeat(Math.max(0, empty - (filled < width ? 1 : 0)));
  return (
    <Text>
      [{bar}] {Math.round(clamped)}%
    </Text>
  );
}
