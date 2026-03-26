/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { Text } from "ink";
import { useCliTheme } from "../CliThemeContext";

interface StreamOutputProps {
  readonly text: string;
}

export function StreamOutput({ text }: StreamOutputProps): React.ReactElement {
  const theme = useCliTheme();
  if (!text) return <Text />;
  const color = theme.level === "advanced" ? theme.fg : undefined;
  return <Text color={color}>{text}</Text>;
}
