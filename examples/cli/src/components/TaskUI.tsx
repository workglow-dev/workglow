/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { DownloadModelTask } from "@workglow/ai";
import { ITask, ITaskGraph, TaskStatus } from "@workglow/task-graph";
import { ArrayTask } from "@workglow/tasks";
import type { FC } from "react";
import { memo, useEffect, useState } from "react";
import { Box, Text } from "retuink";
import { createBar, Spinner, symbols } from "./Elements";

const StatusIcon = memo(
  ({ status, dependant }: { status: TaskStatus; dependant: boolean }) => {
    const dep = (
      <Text color="grey">{!dependant ? symbols.arrowDashedRight : symbols.arrowDashedDown} </Text>
    );
    let sym = null;
    if (status === TaskStatus.PROCESSING) {
      sym = <Spinner color="yellow" />;
    }

    if (status === TaskStatus.ABORTING) {
      sym = <Text color="yellow">{symbols.warning}</Text>;
    }

    if (status === TaskStatus.FAILED) {
      sym = <Text color="red">{symbols.cross}</Text>;
    }

    if (status === TaskStatus.DISABLED) {
      sym = <Text color="gray">{symbols.info}</Text>;
    }

    if (status === TaskStatus.COMPLETED) {
      sym = <Text color="green">{symbols.tick}</Text>;
    }

    if (status === TaskStatus.PENDING) {
      sym = <Text color="gray">{symbols.squareSmallFilled}</Text>;
    }

    return (
      <>
        {dep}
        {sym}
      </>
    );
  },
  (prevProps, nextProps) => prevProps.status === nextProps.status
);

export const TaskUI: FC<{
  task: ITask;
  graph: ITaskGraph;
  dependant?: boolean;
}> = ({ task, graph, dependant = false }) => {
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [input, setInput] = useState<string>(JSON.stringify(task.runInputData).slice(0, 200));
  const [output, setOutput] = useState<string>(JSON.stringify(task.runOutputData).slice(0, 200));
  const [progress, setProgress] = useState<number>(task.progress);
  const [progressMessage, setProgressMessage] = useState<string>("");
  const [progressDetails, setProgressDetails] = useState<any>(undefined);
  const [progressGenerationText, setProgressGenerationText] = useState<string>("");
  const [subGraphTasks, setSubGraphTasks] = useState<ITask[]>([]);
  const [dependantChildren, setDependantChildren] = useState<ITask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [arrayProgress, setArrayProgress] = useState<{ completed: number; total: number } | null>(
    null
  );

  useEffect(() => {
    const onStart = () => {
      setStatus(TaskStatus.PROCESSING);
      setInput(JSON.stringify(task.runInputData).slice(0, 200));
      setOutput(JSON.stringify(task.runOutputData).slice(0, 200));
      setError(null);
      setArrayProgress(null);
      setProgressGenerationText("");
      setProgressMessage("");
      setProgress(0);
      setProgressDetails(undefined);
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
      setOutput(JSON.stringify(task.runOutputData).slice(0, 200));
      setError(null);
    };

    const onError = (error: any) => {
      setStatus(TaskStatus.FAILED);
      setError((prevErr) => (prevErr ? `${error?.message}` : error?.message));
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
          (t: ITask) => task.subGraph.getSourceDataflows(t.config.id).length == 0
        );
        setSubGraphTasks(tasks);
      }
    };

    const onAbort = () => {
      setStatus(TaskStatus.ABORTING);
      setError((prevErr) => (prevErr ? `${prevErr}\nAborted` : "Aborted"));
    };
    onRegenerate();
    setDependantChildren(graph.getTargetTasks(task.config.id));

    task.on("start", onStart);
    task.on("progress", onProgress);
    task.on("complete", onComplete);
    task.on("error", onError);
    task.on("regenerate", onRegenerate);
    task.on("abort", onAbort);

    return () => {
      task.off("start", onStart);
      task.off("progress", onProgress);
      task.off("complete", onComplete);
      task.off("error", onError);
      task.off("regenerate", onRegenerate);
      task.off("abort", onAbort);
    };
  }, [task, graph]);

  return (
    <Box key={task.config.id as string} flexDirection="column">
      <Box height={error ? 3 : 1}>
        <Box marginRight={1} flexShrink={0}>
          <StatusIcon status={status} dependant={dependant} />
        </Box>

        <Box flexShrink={0}>
          <Text>{task.config.name || (task.config.id as string)}</Text>
        </Box>
        {status == TaskStatus.PROCESSING && progress == 0 && (
          <Box marginLeft={2}>
            <Text color="gray" wrap="truncate-middle">{`${symbols.arrowLeft} ${input}`}</Text>
          </Box>
        )}

        {status === TaskStatus.PROCESSING && progress > 0 && (
          <Box marginLeft={2} flexShrink={1}>
            <Text dimColor>[{status}]</Text>
            <Text dimColor>
              {progress > 0 &&
                ` ${createBar(progress / 100, 20)} ${progressMessage ?? ""} ${Math.round(progress)}%`}
            </Text>
          </Box>
        )}
        {status == TaskStatus.COMPLETED && (
          <Box marginLeft={2} flexShrink={1}>
            <Text color="gray" wrap="truncate">{`${symbols.arrowRight} ${output}`}</Text>
          </Box>
        )}
        {error && (
          <Box marginLeft={2} flexShrink={1}>
            <Text color="red">{`${symbols.warning} ${error.includes(": ") ? error.substring(error.indexOf(": ") + 2) : error}`}</Text>
          </Box>
        )}
      </Box>
      {status == TaskStatus.PROCESSING &&
        progressDetails &&
        progressMessage == "Downloading model" &&
        progressDetails.map((d: any) => (
          <Box marginLeft={2} key={d.file}>
            <Text color="gray">{`${symbols.arrowDashedRight} ${createBar(d.progress / 100, 10)} ${d.file} ${Math.round(d.progress)}%`}</Text>
          </Box>
        ))}
      {status == TaskStatus.PROCESSING &&
        progressGenerationText &&
        progressMessage == "Generating" && (
          <Box marginLeft={2}>
            <Text color="gray">{`${symbols.arrowDashedRight} ${createBar(progress / 100, 10)} ${progressGenerationText ?? ""}`}</Text>
          </Box>
        )}
      {arrayProgress && (
        <Box marginLeft={2}>
          <Text color="gray">{`${symbols.arrowDashedRight} Processing array tasks: ${arrayProgress.completed}/${arrayProgress.total} completed ${createBar(arrayProgress.completed / arrayProgress.total, 10)}`}</Text>
        </Box>
      )}
      {!arrayProgress && subGraphTasks.length > 0 && !(task instanceof ArrayTask) && (
        <Box flexDirection="column" marginLeft={2} borderColor="gray">
          {subGraphTasks.map((taskItem) => (
            <TaskUI key={`${taskItem.config.id}`} task={taskItem} graph={task.subGraph} />
          ))}
        </Box>
      )}
      {dependantChildren && (
        <Box flexDirection="column">
          {dependantChildren.map((taskItem) => (
            <TaskUI key={`${taskItem.config.id}`} task={taskItem} graph={graph} dependant={true} />
          ))}
        </Box>
      )}
    </Box>
  );
};
