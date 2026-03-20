/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { Text } from "ink";

/** Braille-pattern frames (same family as cli-spinners “dots”). */
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

interface CliSpinnerProps {
  readonly color?: string;
}

export function CliSpinner({ color }: CliSpinnerProps): React.ReactElement {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setFrame((n) => (n + 1) % FRAMES.length);
    }, 80);
    return () => clearInterval(id);
  }, []);
  return <Text color={color}>{FRAMES[frame]}</Text>;
}
