/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { TaskGraph } from "@workglow/task-graph";
import { sortCliTaskLinesForDisplay, startGraphTaskPoll } from "./cliTaskUi";
import { ProgressBar } from "./components/ProgressBar";
import { TaskStatusProgressRow } from "./components/TaskStatusProgressRow";
import { useCliTheme } from "./CliThemeContext";
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
  /**
   * When set (e.g. from {@link Workflow.run}), runs this instead of `graph.run(input, config)` so
   * abort/output-cache/merge semantics match the Workflow API.
   */
  readonly runExecutor?: () => Promise<unknown>;
  readonly onComplete: (result: unknown) => void;
  readonly onError: (error: Error) => void;
}

export function WorkflowRunApp({
  graph,
  input,
  config,
  runExecutor,
  onComplete,
  onError,
}: WorkflowRunAppProps): React.ReactElement {
  const theme = useCliTheme();
  const bodyColor = theme.level === "advanced" ? theme.fg : undefined;
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

    const runPromise = runExecutor ? runExecutor() : graph.run(input, config);
    runPromise.then((result) => onComplete(result)).catch((err) => onError(err));

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
          <Box flexDirection="row" justifyContent="space-between" width="100%">
            <Text color={bodyColor}>Workflow: </Text>
            <Box flexShrink={0} marginLeft={1}>
              <ProgressBar progress={overallProgress} />
            </Box>
          </Box>
        )}
        {orderedTasks.map((t) => {
          const slots = iterationSlots.get(t.id);
          const sortedSlots = slots ? sortIterationSlotsForDisplay(slots) : [];
          return (
            <Box key={t.id} flexDirection="column">
              <TaskStatusProgressRow
                type={t.type}
                status={t.status}
                message={t.message}
                barProgress={t.progress ?? 0}
              />
              {sortedSlots.map((slot) => (
                <Box key={`${t.id}-iter-${slot.index}`} flexDirection="column" paddingLeft={2}>
                  <TaskStatusProgressRow
                    type={`#${slot.index + 1}`}
                    status={iterationSlotToTaskStatus(slot.status)}
                    message={slot.status === "completed" ? undefined : slot.message}
                    barProgress={slot.progress ?? 0}
                    suppressProgressBar={slot.status !== "running" || slot.progress === undefined}
                  />
                </Box>
              ))}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
