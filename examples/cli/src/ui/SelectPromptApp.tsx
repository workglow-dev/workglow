/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { Box, Text, useInput } from "ink";
import { Select } from "@inkjs/ui";

interface SelectPromptAppProps {
  readonly message?: string;
  readonly options: Array<{ label: string; value: string }>;
  readonly onSelect: (value: string) => void;
  readonly onCancel: () => void;
}

export function SelectPromptApp({
  message,
  options,
  onSelect,
  onCancel,
}: SelectPromptAppProps): React.ReactElement {
  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column">
      {message && (
        <Box marginBottom={1}>
          <Text bold color="cyan">
            {message}
          </Text>
        </Box>
      )}
      <Select options={options} onChange={onSelect} />
      <Box marginTop={1}>
        <Text dimColor>Enter select Esc cancel</Text>
      </Box>
    </Box>
  );
}
