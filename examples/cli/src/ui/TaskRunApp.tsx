/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { Box, Text, Static } from "ink";
import type { TaskGraph } from "@workglow/task-graph";
import {
  cliTaskShowsProgressBar,
  sortCliTaskLinesForDisplay,
  startGraphTaskPoll,
  startTaskInstancePoll,
} from "./cliTaskUi";
import { ProgressBar } from "./components/ProgressBar";
import { StreamOutput } from "./components/StreamOutput";
import { TaskStatusLine } from "./components/TaskStatusLine";
import type { CliTaskLine, IterationSlotRow } from "./taskGraphCliSubscriptions";
import {
  iterationSlotToTaskStatus,
  sortIterationSlotsForDisplay,
  subscribeTaskGraphForCli,
} from "./taskGraphCliSubscriptions";

interface TaskRunAppProps {
  readonly task: {
    run(overrides?: Record<string, unknown>): Promise<unknown>;
    events: {
      on(event: string, fn: (...args: any[]) => void): void;
    };
  };
  readonly taskType: string;
  readonly onComplete: (result: unknown) => void;
  readonly onError: (error: Error) => void;
}

interface LogLine {
  readonly id: number;
  readonly text: string;
}

export function TaskRunApp({
  task,
  taskType,
  onComplete,
  onError,
}: TaskRunAppProps): React.ReactElement {
  const [status, setStatus] = useState("PENDING");
  const [progress, setProgress] = useState<number | undefined>(undefined);
  const [progressMessage, setProgressMessage] = useState<string | undefined>(undefined);
  const [streamText, setStreamText] = useState("");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [subTaskInfos, setSubTaskInfos] = useState<Map<string, CliTaskLine>>(new Map());
  const [subOverallProgress, setSubOverallProgress] = useState<number | undefined>(undefined);
  const [subIterationSlots, setSubIterationSlots] = useState<Map<string, IterationSlotRow[]>>(
    new Map()
  );
  useEffect(() => {
    let logCounter = 0;

    task.events.on("status", (newStatus: string) => {
      setStatus(newStatus);
    });

    task.events.on("progress", (prog: number, msg?: string) => {
      setProgress(prog);
      if (msg) setProgressMessage(msg);
    });

    task.events.on("stream_chunk", (event: { type: string; text?: string }) => {
      if (event.type === "text-delta" && event.text) {
        setStreamText((prev) => prev + event.text);
      }
    });

    task.events.on("stream_end", () => {
      setStreamText((prev) => {
        if (prev) {
          setLogs((logs) => [...logs, { id: logCounter++, text: prev }]);
        }
        return "";
      });
    });

    const stopPollTask = startTaskInstancePoll(
      () => task as unknown as { status?: string; progress?: number },
      setStatus,
      setProgress
    );

    let unsubSubgraph: (() => void) | undefined;
    let stopSubPoll: (() => void) | undefined;

    /** Attach once when `hasChildren()` becomes true (may happen after `run()` starts). */
    const tryAttachSubgraph = (): void => {
      if (unsubSubgraph) return;
      const compound = task as unknown as { hasChildren?: () => boolean; subGraph?: TaskGraph };
      if (
        typeof compound.hasChildren !== "function" ||
        !compound.hasChildren() ||
        !compound.subGraph
      ) {
        return;
      }
      unsubSubgraph = subscribeTaskGraphForCli(
        compound.subGraph,
        setSubTaskInfos,
        undefined,
        setSubOverallProgress,
        setSubIterationSlots
      );
      stopSubPoll = startGraphTaskPoll(compound.subGraph, setSubTaskInfos);
    };

    tryAttachSubgraph();
    const attachInterval = setInterval(tryAttachSubgraph, 150);

    task
      .run()
      .then((result) => onComplete(result))
      .catch((err) => onError(err));

    return () => {
      clearInterval(attachInterval);
      stopPollTask();
      unsubSubgraph?.();
      stopSubPoll?.();
    };
  }, []);

  const subOrder =
    typeof (task as unknown as { hasChildren?: () => boolean }).hasChildren === "function" &&
    (task as unknown as { hasChildren: () => boolean }).hasChildren() &&
    (task as unknown as { subGraph?: TaskGraph }).subGraph
      ? new Map(
          (task as unknown as { subGraph: TaskGraph }).subGraph
            .getTasks()
            .map((t, i) => [String(t.id), i])
        )
      : new Map<string, number>();
  const orderedSubTasks = sortCliTaskLinesForDisplay(Array.from(subTaskInfos.values()), subOrder);

  return (
    <Box flexDirection="column">
      <Static items={logs}>{(log) => <Text key={log.id}>{log.text}</Text>}</Static>

      <Box flexDirection="column">
        <TaskStatusLine
          type={taskType}
          status={status}
          progress={progress}
          message={progressMessage}
        />
        {cliTaskShowsProgressBar(status) && (
          <ProgressBar
            progress={progress ?? (task as unknown as { progress?: number }).progress ?? 0}
          />
        )}
        {streamText && <StreamOutput text={streamText} />}
        {(subTaskInfos.size > 0 || subOverallProgress !== undefined) && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>Subtasks</Text>
            {subOverallProgress !== undefined && (
              <Box marginLeft={2}>
                <Text>Subgraph: </Text>
                <ProgressBar progress={subOverallProgress} />
              </Box>
            )}
            {orderedSubTasks.map((t) => {
              const slots = subIterationSlots.get(t.id);
              const sortedSlots = slots ? sortIterationSlotsForDisplay(slots) : [];
              return (
                <Box key={t.id} flexDirection="column" marginLeft={2}>
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
        )}
      </Box>
    </Box>
  );
}
