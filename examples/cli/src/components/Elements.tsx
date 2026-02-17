/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { memo, useEffect, useState } from "react";
import { Text } from "ink";

/**
 * createBar
 *
 * Features:
 * - Unicode-based progress bar generation
 * - Customizable bar length and progress indication
 * - Color-coded output using chalk
 *
 * Used to create visual feedback for long-running tasks in the CLI interface,
 * with smooth progress transitions and clear visual indicators.
 */
export function createBar(progress: number, length: number): string {
  let distance = progress * length;
  let bar = "";
  // Add main portion
  bar += "\u2588".repeat(Math.floor(distance));
  // Add intermediate porttion
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
    case 8:
      bar += "\u2588";
      break;
  }

  // Extend empty bar
  bar += "\u258F".repeat(length > bar.length ? length - bar.length : 0);

  return "\u2595" + bar + "\u258F";
}

export const symbols = {
  tick: "✔",
  info: "ℹ",
  warning: "⚠",
  cross: "×",
  squareSmallFilled: "◼",
  pointer: "❯",
  arrowUp: "↑",
  arrowDown: "↓",
  arrowLeft: "←",
  arrowRight: "→",
  arrowUpDown: "↕",
  arrowLeftRight: "↔",
  arrowUpLeft: "↖",
  arrowUpRight: "↗",
  arrowDownLeft: "↙",
  arrowDownRight: "↘",
  arrowDashedDown: "⇣",
  arrowDashedUp: "⇡",
  arrowDashedLeft: "⇠",
  arrowDashedRight: "⇢",
};

const SPINNER_INTERVAL = 90;
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export const Spinner = memo(
  ({ color }: { color?: string }) => {
    const [frameIndex, setFrameIndex] = useState(0);

    useEffect(() => {
      const timer = setInterval(() => {
        setFrameIndex((prevIndex) => (prevIndex + 1) % SPINNER_FRAMES.length);
      }, SPINNER_INTERVAL);

      return () => clearInterval(timer);
    }, []);

    return <Text color={color}>{SPINNER_FRAMES[frameIndex]}</Text>;
  },
  (prevProps, nextProps) => prevProps.color === nextProps.color
);
