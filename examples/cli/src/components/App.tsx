/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ITaskGraph } from "@workglow/task-graph";
import React from "react";
import { Box } from "ink";
import TaskGraphUI from "./TaskGraphUI";

type AppProps = {
  graph: ITaskGraph;
};

const App: React.FC<AppProps> = ({ graph }) => {
  return (
    <Box flexDirection="column" paddingTop={1}>
      <TaskGraphUI graph={graph} />
    </Box>
  );
};

export default App;
