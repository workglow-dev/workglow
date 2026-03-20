/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { Text } from "ink";
import { cliTaskShowsProgressBar, cliTaskStatusGlyph, cliTaskStatusGlyphColor } from "../cliTaskUi";
import { CliSpinner } from "./CliSpinner";

interface TaskStatusLineProps {
  readonly type: string;
  readonly status: string;
  readonly progress?: number;
  readonly message?: string;
}

export function TaskStatusLine({
  type,
  status,
  progress,
  message,
}: TaskStatusLineProps): React.ReactElement {
  const glyph = cliTaskStatusGlyph(status);
  const color = cliTaskStatusGlyphColor(status);
  const progressText = progress !== undefined ? ` ${Math.round(progress)}%` : "";
  const msgText = message ? ` — ${message}` : "";
  const showSpinner = cliTaskShowsProgressBar(status);

  return (
    <Text>
      {showSpinner ? <CliSpinner color={color} /> : <Text color={color}>{glyph}</Text>} {type}
      {progressText}
      {msgText}
    </Text>
  );
}
