/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { DownloadModelTask } from "@workglow/ai";
import { ITask, ITaskGraph, TaskStatus, type StreamEvent } from "@workglow/task-graph";
import { ArrayTask } from "@workglow/tasks";
import { Box, Text } from "ink";
import type { FC } from "react";
import { memo, useEffect, useRef, useState } from "react";
import { createBar, formatDuration, Spinner, symbols } from "./Elements";

const StatusIcon = memo(
  ({ status }: { status: TaskStatus }) => {
    if (status === TaskStatus.PROCESSING || status === TaskStatus.STREAMING) {
      return <Spinner color="yellow" />;
    }
    if (status === TaskStatus.ABORTING) {
      return <Text color="yellow">{symbols.warning}</Text>;
    }
    if (status === TaskStatus.FAILED) {
      return <Text color="red">{symbols.cross}</Text>;
    }
    if (status === TaskStatus.DISABLED) {
      return <Text color="gray">{symbols.info}</Text>;
    }
    if (status === TaskStatus.COMPLETED) {
      return <Text color="green">{symbols.tick}</Text>;
    }
    return <Text color="gray">{symbols.squareSmallFilled}</Text>;
  },
  (prevProps, nextProps) => prevProps.status === nextProps.status
);

export const TaskUI: FC<{
  task: ITask;
  graph: ITaskGraph;
  indent?: number;
}> = ({ task, graph, indent = 0 }) => {
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [progress, setProgress] = useState<number>(task.progress);
  const [progressMessage, setProgressMessage] = useState<string>("");
  const [progressDetails, setProgressDetails] = useState<any>(undefined);
  const [progressGenerationText, setProgressGenerationText] = useState<string>("");
  const [subGraphTasks, setSubGraphTasks] = useState<ITask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [arrayProgress, setArrayProgress] = useState<{ completed: number; total: number } | null>(
    null
  );
  const [streamingText, setStreamingText] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [startedAt, setStartedAt] = useState<Date | undefined>(task.startedAt);
  const [completedAt, setCompletedAt] = useState<Date | undefined>(task.completedAt);
  const [elapsed, setElapsed] = useState<string>("");
  const streamingTextRef = useRef<string>("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const onStart = () => {
      setStatus(TaskStatus.PROCESSING);
      setError(null);
      setArrayProgress(null);
      setProgressGenerationText("");
      setProgressMessage("");
      setProgress(0);
      setProgressDetails(undefined);
      setStartedAt(new Date());
      setCompletedAt(undefined);
    };

    const onProgress = (...args: any[]) => {
      const [newProgress, newMessage, newDetails] = args;

      setProgress(newProgress);
      setProgressMessage(newMessage);

      if (newMessage === "Downloading model" && newDetails) {
        setProgressDetails((oldDetails: any) => {
          if (oldDetails == null) {
            return [newDetails];
          }
          const found = oldDetails.find((d: any) => d.file === newDetails.file);
          if (found) {
            return oldDetails.map((d: any) => (d.file === newDetails.file ? newDetails : d));
          }
          return [...oldDetails, newDetails];
        });
      } else if (newMessage === "Generating" && newDetails?.text) {
        setProgressGenerationText((prevText) => prevText + newDetails.text);
      }
    };

    const onComplete = () => {
      setStatus(TaskStatus.COMPLETED);
      const now = new Date();
      setCompletedAt(now);
      setError(null);
    };

    const onError = (error: any) => {
      setStatus(TaskStatus.FAILED);
      setCompletedAt(new Date());
      setError(error?.message ?? String(error));
    };

    const onRegenerate = () => {
      if (
        task &&
        task instanceof ArrayTask &&
        !(task instanceof DownloadModelTask) &&
        task.hasChildren()
      ) {
        const tasks = task.subGraph.getTasks();
        setArrayProgress({
          completed: tasks.filter((t: ITask) => t.status === TaskStatus.COMPLETED).length,
          total: tasks.length,
        });
        setSubGraphTasks([]);
      } else {
        const childTasks = task.hasChildren() ? task.subGraph.getTasks() : [];
        const tasks = childTasks.filter(
          (t: ITask) => task.subGraph.getSourceDataflows(t.id).length == 0
        );
        setSubGraphTasks(tasks);
      }
    };

    const onAbort = () => {
      setStatus(TaskStatus.ABORTING);
      setCompletedAt(new Date());
      setError((prevErr) => (prevErr ? `${prevErr}\nAborted` : "Aborted"));
    };

    const onStreamStart = () => {
      setStatus(TaskStatus.STREAMING);
      setIsStreaming(true);
      setStreamingText("");
      streamingTextRef.current = "";
    };

    const onStreamChunk = (event: StreamEvent) => {
      if (event.type === "text-delta") {
        streamingTextRef.current += event.textDelta;
        setStreamingText(streamingTextRef.current);
      } else if (event.type === "snapshot") {
        const text = typeof event.data === "string" ? event.data : JSON.stringify(event.data);
        streamingTextRef.current = text;
        setStreamingText(text);
      }
    };

    const onStreamEnd = () => {
      setIsStreaming(false);
    };

    onRegenerate();

    task.on("start", onStart);
    task.on("progress", onProgress);
    task.on("complete", onComplete);
    task.on("error", onError);
    task.on("regenerate", onRegenerate);
    task.on("abort", onAbort);
    task.on("stream_start", onStreamStart);
    task.on("stream_chunk", onStreamChunk);
    task.on("stream_end", onStreamEnd);

    return () => {
      task.off("start", onStart);
      task.off("progress", onProgress);
      task.off("complete", onComplete);
      task.off("error", onError);
      task.off("regenerate", onRegenerate);
      task.off("abort", onAbort);
      task.off("stream_start", onStreamStart);
      task.off("stream_chunk", onStreamChunk);
      task.off("stream_end", onStreamEnd);
    };
  }, [task, graph]);

  // Live elapsed-time ticker for in-progress tasks
  useEffect(() => {
    if (
      (status === TaskStatus.PROCESSING || status === TaskStatus.STREAMING) &&
      startedAt &&
      !completedAt
    ) {
      const tick = () => setElapsed(formatDuration(startedAt, undefined));
      tick();
      timerRef.current = setInterval(tick, 100);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    } else if (startedAt && completedAt) {
      setElapsed(formatDuration(startedAt, completedAt));
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [status, startedAt, completedAt]);

  const taskTitle = task.config.title || task.type || (task.id as string);

  return (
    <Box key={task.id as string} flexDirection="column" marginLeft={indent}>
      {/* Main task line */}
      <Box>
        <Box width={2} flexShrink={0}>
          <StatusIcon status={status} />
        </Box>
        <Box flexShrink={0}>
          <Text
            bold={status === TaskStatus.PROCESSING || status === TaskStatus.STREAMING}
            dimColor={status === TaskStatus.PENDING || status === TaskStatus.DISABLED}
          >
            {taskTitle}
          </Text>
        </Box>

        {/* Progress bar inline for processing tasks */}
        {status === TaskStatus.PROCESSING && progress > 0 && (
          <Box marginLeft={1} flexShrink={1}>
            <Text dimColor>
              {createBar(progress / 100, 15)} {Math.round(progress)}%
            </Text>
          </Box>
        )}

        {/* Duration on the right */}
        {elapsed && (
          <Box marginLeft={1} flexShrink={0}>
            <Text dimColor>{elapsed}</Text>
          </Box>
        )}

        {/* Error summary inline */}
        {error && status === TaskStatus.FAILED && (
          <Box marginLeft={1} flexShrink={1}>
            <Text color="red" wrap="truncate">
              {error.includes(": ") ? error.substring(error.indexOf(": ") + 2) : error}
            </Text>
          </Box>
        )}

        {/* Aborting inline */}
        {status === TaskStatus.ABORTING && (
          <Box marginLeft={1}>
            <Text color="yellow">aborted</Text>
          </Box>
        )}
      </Box>

      {/* Detail lines (indented under the task) */}
      {status === TaskStatus.PROCESSING &&
        progressDetails &&
        progressMessage === "Downloading model" &&
        progressDetails.map((d: any) => (
          <Box marginLeft={2} key={d.file}>
            <Text dimColor>
              {createBar(d.progress / 100, 10)} {d.file} {Math.round(d.progress)}%
            </Text>
          </Box>
        ))}

      {status === TaskStatus.PROCESSING &&
        progressGenerationText &&
        progressMessage === "Generating" && (
          <Box marginLeft={2}>
            <Text dimColor wrap="truncate">
              {progressGenerationText}
            </Text>
          </Box>
        )}

      {(status === TaskStatus.STREAMING || isStreaming) && streamingText && (
        <Box marginLeft={2}>
          <Text color="cyan" wrap="truncate">
            {streamingText.length > 200 ? streamingText.slice(-200) : streamingText}
          </Text>
        </Box>
      )}

      {arrayProgress && (
        <Box marginLeft={2}>
          <Text dimColor>
            {arrayProgress.completed}/{arrayProgress.total} completed{" "}
            {createBar(arrayProgress.completed / arrayProgress.total, 10)}
          </Text>
        </Box>
      )}

      {/* Sub-graph tasks (nested) */}
      {!arrayProgress &&
        subGraphTasks.length > 0 &&
        !(task instanceof ArrayTask) &&
        subGraphTasks.map((taskItem) => (
          <TaskUI key={`${taskItem.id}`} task={taskItem} graph={task.subGraph} indent={2} />
        ))}
    </Box>
  );
};
