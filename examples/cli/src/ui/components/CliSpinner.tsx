/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { Text } from "ink";

/** Braille-pattern frames (same family as cli-spinners “dots”). */
export const CLI_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

interface CliSpinnerProps {
  readonly color?: string;
  /** When set, parent drives animation (e.g. batched with progress updates). */
  readonly frameIndex?: number;
}

export function CliSpinner({ color, frameIndex }: CliSpinnerProps): React.ReactElement {
  const [frame, setFrame] = useState(0);
  const controlled = frameIndex !== undefined;
  useEffect(() => {
    if (controlled) return;
    const id = setInterval(() => {
      setFrame((n) => (n + 1) % CLI_SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(id);
  }, [controlled]);
  const i = controlled ? frameIndex % CLI_SPINNER_FRAMES.length : frame;
  return <Text color={color}>{CLI_SPINNER_FRAMES[i]}</Text>;
}
