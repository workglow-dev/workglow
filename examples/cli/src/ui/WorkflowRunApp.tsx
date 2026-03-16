/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { Box, Text, Static } from "ink";
import type { TaskGraph } from "@workglow/task-graph";
import { ProgressBar } from "./components/ProgressBar";
import { TaskStatusLine } from "./components/TaskStatusLine";

interface TaskInfo {
  readonly id: string;
  readonly type: string;
  status: string;
  progress?: number;
  message?: string;
}

interface LogLine {
  readonly id: number;
  readonly text: string;
}

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
  const [taskInfos, setTaskInfos] = useState<Map<string, TaskInfo>>(new Map());
  const [overallProgress, setOverallProgress] = useState<number | undefined>(undefined);
  const [completedLogs, setCompletedLogs] = useState<LogLine[]>([]);
  useEffect(() => {
    let logCounter = 0;
    const tasks = graph.getTasks();

    // Initialize task status map
    const initial = new Map<string, TaskInfo>();
    for (const task of tasks) {
      const taskId = String(task.id);
      const taskType = (task as any).type ?? "Unknown";
      initial.set(taskId, { id: taskId, type: taskType, status: "PENDING" });

      task.events.on("status", (status: string) => {
        setTaskInfos((prev) => {
          const next = new Map(prev);
          const info = next.get(taskId);
          if (info) {
            next.set(taskId, { ...info, status });
            if (status === "COMPLETED") {
              setCompletedLogs((logs) => [
                ...logs,
                { id: logCounter++, text: `[COMPLETED] ${taskType}` },
              ]);
            }
          }
          return next;
        });
      });

      task.events.on("progress", (progress: number, message?: string) => {
        setTaskInfos((prev) => {
          const next = new Map(prev);
          const info = next.get(taskId);
          if (info) {
            next.set(taskId, { ...info, progress, message });
          }
          return next;
        });
      });
    }
    setTaskInfos(initial);

    graph.on("graph_progress", (progress: number) => {
      setOverallProgress(progress);
    });

    graph
      .run(input, config)
      .then((result) => onComplete(result))
      .catch((err) => onError(err));
  }, []);

  const activeTasks = Array.from(taskInfos.values()).filter(
    (t) => t.status !== "PENDING" && t.status !== "COMPLETED"
  );

  return (
    <Box flexDirection="column">
      <Static items={completedLogs}>
        {(log) => (
          <Text key={log.id}>{log.text}</Text>
        )}
      </Static>

      <Box flexDirection="column">
        {overallProgress !== undefined && (
          <Box>
            <Text>Workflow: </Text>
            <ProgressBar progress={overallProgress} />
          </Box>
        )}
        {activeTasks.map((t) => (
          <TaskStatusLine
            key={t.id}
            type={t.type}
            status={t.status}
            progress={t.progress}
            message={t.message}
          />
        ))}
      </Box>
    </Box>
  );
}
