/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { TaskGraph } from "@workglow/task-graph";
import {
  cliTaskShowsProgressBar,
  sortCliTaskLinesForDisplay,
  startGraphTaskPoll,
} from "./cliTaskUi";
import { ProgressBar } from "./components/ProgressBar";
import { TaskStatusLine } from "./components/TaskStatusLine";
import type { CliTaskLine, IterationSlotRow } from "./taskGraphCliSubscriptions";
import {
  iterationSlotToTaskStatus,
  sortIterationSlotsForDisplay,
  subscribeTaskGraphForCli,
} from "./taskGraphCliSubscriptions";

interface WorkflowRunAppProps {
  readonly graph: TaskGraph;
  readonly input: Record<string, unknown>;
  readonly config?: Record<string, unknown>;
  readonly onComplete: (result: unknown) => void;
  readonly onError: (error: Error) => void;
}

export function WorkflowRunApp({
  graph,
  input,
  config,
  onComplete,
  onError,
}: WorkflowRunAppProps): React.ReactElement {
  const [taskInfos, setTaskInfos] = useState<Map<string, CliTaskLine>>(new Map());
  const [overallProgress, setOverallProgress] = useState<number | undefined>(undefined);
  const [iterationSlots, setIterationSlots] = useState<Map<string, IterationSlotRow[]>>(new Map());
  useEffect(() => {
    const unsub = subscribeTaskGraphForCli(
      graph,
      setTaskInfos,
      undefined,
      setOverallProgress,
      setIterationSlots
    );
    const stopPoll = startGraphTaskPoll(graph, setTaskInfos);

    graph
      .run(input, config)
      .then((result) => onComplete(result))
      .catch((err) => onError(err));

    return () => {
      stopPoll();
      unsub();
    };
  }, []);

  const order = new Map(graph.getTasks().map((t, i) => [String(t.id), i]));
  const orderedTasks = sortCliTaskLinesForDisplay(Array.from(taskInfos.values()), order);

  return (
    <Box flexDirection="column">
      <Box flexDirection="column">
        {overallProgress !== undefined && (
          <Box flexDirection="column">
            <Box>
              <Text>Workflow: </Text>
              <ProgressBar progress={overallProgress} />
            </Box>
          </Box>
        )}
        {orderedTasks.map((t) => {
          const slots = iterationSlots.get(t.id);
          const sortedSlots = slots ? sortIterationSlotsForDisplay(slots) : [];
          return (
            <Box key={t.id} flexDirection="column">
              <TaskStatusLine
                type={t.type}
                status={t.status}
                progress={t.progress}
                message={t.message}
              />
              {cliTaskShowsProgressBar(t.status) && (
                <Box marginLeft={2}>
                  <ProgressBar progress={t.progress ?? 0} />
                </Box>
              )}
              {sortedSlots.map((slot) => (
                <Box key={`${t.id}-iter-${slot.index}`} flexDirection="column" marginLeft={2}>
                  <TaskStatusLine
                    type={`#${slot.index + 1}`}
                    status={iterationSlotToTaskStatus(slot.status)}
                    progress={slot.status === "completed" ? undefined : slot.progress}
                    message={slot.status === "completed" ? undefined : slot.message}
                  />
                  {slot.status === "running" && slot.progress !== undefined && (
                    <Box marginLeft={2}>
                      <ProgressBar progress={slot.progress} />
                    </Box>
                  )}
                </Box>
              ))}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
