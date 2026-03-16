/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { Box, Text, Static } from "ink";
import { ProgressBar } from "./components/ProgressBar";
import { StreamOutput } from "./components/StreamOutput";
import { TaskStatusLine } from "./components/TaskStatusLine";

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

export function TaskRunApp({ task, taskType, onComplete, onError }: TaskRunAppProps): React.ReactElement {
  const [status, setStatus] = useState("PENDING");
  const [progress, setProgress] = useState<number | undefined>(undefined);
  const [progressMessage, setProgressMessage] = useState<string | undefined>(undefined);
  const [streamText, setStreamText] = useState("");
  const [logs, setLogs] = useState<LogLine[]>([]);
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

    task
      .run()
      .then((result) => onComplete(result))
      .catch((err) => onError(err));
  }, []);

  return (
    <Box flexDirection="column">
      <Static items={logs}>
        {(log) => (
          <Text key={log.id}>{log.text}</Text>
        )}
      </Static>

      <Box flexDirection="column">
        <TaskStatusLine
          type={taskType}
          status={status}
          progress={progress}
          message={progressMessage}
        />
        {progress !== undefined && status === "PROCESSING" && (
          <ProgressBar progress={progress} />
        )}
        {streamText && <StreamOutput text={streamText} />}
      </Box>
    </Box>
  );
}
