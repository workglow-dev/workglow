/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { Text } from "ink";
import { useCliTheme } from "../CliThemeContext";

interface ProgressBarProps {
  readonly progress: number;
  readonly width?: number;
}

/**
 * Build a Unicode block-character progress bar with 8-level sub-pixel precision.
 * Uses U+2588–U+258F fractional blocks for smooth animation.
 */
function createBar(progress: number, length: number): string {
  const distance = progress * length;
  let bar = "";
  bar += "\u2588".repeat(Math.floor(distance));
  const c = Math.round((distance % 1) * 7);
  switch (c) {
    case 1:
      bar += "\u258F";
      break;
    case 2:
      bar += "\u258E";
      break;
    case 3:
      bar += "\u258D";
      break;
    case 4:
      bar += "\u258C";
      break;
    case 5:
      bar += "\u258B";
      break;
    case 6:
      bar += "\u258A";
      break;
    case 7:
      bar += "\u2589";
      break;
  }
  bar += "\u258F".repeat(length > bar.length ? length - bar.length : 0);
  return "\u2595" + bar + "\u258F";
}

export function ProgressBar({ progress, width = 15 }: ProgressBarProps): React.ReactElement {
  const theme = useCliTheme();
  const clamped = Math.max(0, Math.min(100, progress));
  const bar = createBar(clamped / 100, width);
  const color = theme.level === "advanced" ? theme.medium : undefined;
  return <Text color={color}>{bar}</Text>;
}
