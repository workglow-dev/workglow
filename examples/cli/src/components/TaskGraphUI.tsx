/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ITask, ITaskGraph, TaskStatus } from "@workglow/task-graph";
import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";
import { TaskUI } from "./TaskUI";
import { symbols } from "./Elements";

type TaskGraphUIProps = {
  graph: ITaskGraph;
};

/** Maximum visible tasks before collapsing completed ones */
const MAX_VISIBLE = 12;

const TaskGraphUI: React.FC<TaskGraphUIProps> = ({ graph }) => {
  const [tasks, setTasks] = useState<ITask[]>([]);
  const [counts, setCounts] = useState({ total: 0, completed: 0, failed: 0, processing: 0 });

  const refreshTasks = () => {
    const sorted = graph.topologicallySortedNodes();
    setTasks(sorted);
  };

  const refreshCounts = () => {
    const all = graph.getTasks();
    setCounts({
      total: all.length,
      completed: all.filter((t) => t.status === TaskStatus.COMPLETED).length,
      failed: all.filter((t) => t.status === TaskStatus.FAILED).length,
      processing: all.filter(
        (t) => t.status === TaskStatus.PROCESSING || t.status === TaskStatus.STREAMING
      ).length,
    });
  };

  useEffect(() => {
    refreshTasks();
    refreshCounts();

    const graphEvents = ["task_added", "task_removed", "task_replaced"] as const;
    const graphCleanups = graphEvents.map((event) => graph.subscribe(event, refreshTasks));

    const statusCleanup = graph.subscribeToTaskStatus(() => {
      refreshCounts();
    });

    return () => {
      graphCleanups.forEach((cleanup) => cleanup());
      statusCleanup();
    };
  }, [graph]);

  // When there are many tasks, hide completed ones at the top to keep active work visible
  let visibleTasks = tasks;
  let hiddenCompleted = 0;
  if (tasks.length > MAX_VISIBLE) {
    // Find the first non-completed task
    const firstActiveIdx = tasks.findIndex(
      (t) => t.status !== TaskStatus.COMPLETED && t.status !== TaskStatus.DISABLED
    );
    if (firstActiveIdx > 0) {
      // Keep a few completed tasks visible for context
      const keepCompleted = Math.max(0, MAX_VISIBLE - (tasks.length - firstActiveIdx) - 1);
      const startIdx = Math.max(0, firstActiveIdx - keepCompleted);
      hiddenCompleted = startIdx;
      visibleTasks = tasks.slice(startIdx);
    }
  }

  return (
    <Box flexDirection="column">
      {/* Hidden tasks indicator */}
      {hiddenCompleted > 0 && (
        <Box marginBottom={0}>
          <Text dimColor>
            {"  "}
            {symbols.tick} {hiddenCompleted} completed task{hiddenCompleted !== 1 ? "s" : ""}{" "}
            (hidden)
          </Text>
        </Box>
      )}

      {/* Task list */}
      {visibleTasks.map((taskItem) => (
        <TaskUI key={`${taskItem.id}`} graph={graph} task={taskItem} />
      ))}

      {/* Summary bar */}
      {counts.total > 1 && (
        <Box marginTop={1}>
          <Text dimColor>
            {"  "}
            {counts.completed}/{counts.total} tasks completed
            {counts.failed > 0 && <Text color="red"> ({counts.failed} failed)</Text>}
          </Text>
        </Box>
      )}
    </Box>
  );
};

export default TaskGraphUI;
