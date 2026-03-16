/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { Text } from "ink";

interface StreamOutputProps {
  readonly text: string;
}

export function StreamOutput({ text }: StreamOutputProps): React.ReactElement {
  if (!text) return <Text />;
  return <Text>{text}</Text>;
}
