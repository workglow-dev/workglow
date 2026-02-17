/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ITask, TaskStatus } from "@workglow/task-graph";

// Common utility to get status color based on task status (with bg- prefix)
export const getStatusColorBg = (status: TaskStatus): string => {
  switch (status) {
    case TaskStatus.COMPLETED:
      return "bg-green-500";
    case TaskStatus.ABORTING:
    case TaskStatus.FAILED:
      return "bg-red-500";
    case TaskStatus.PROCESSING:
      return "bg-blue-500";
    case TaskStatus.STREAMING:
      return "bg-blue-500";
    case TaskStatus.PENDING:
      return "bg-gray-600";
    case TaskStatus.DISABLED:
      return "bg-yellow-500";
    default:
      return "bg-gray-300";
  }
};

// Get status color without bg- prefix for direct style usage
export const getStatusColor = (status: TaskStatus): string => {
  const color = getStatusColorBg(status);
  return color.startsWith("bg-") ? color.substring(3) : color;
};

// Format task output data for display
export const formatOutputData = (data: unknown): string => {
  if (data === null || data === undefined) return "";

  if (typeof data === "object") {
    try {
      return JSON.stringify(data, null, 2);
    } catch (e) {
      return String(data);
    }
  }

  return String(data);
};

// Get truncated task ID (last part after dash)
export const getTruncatedTaskId = (taskId: string): string => {
  return String(taskId).split("-").pop() || taskId;
};

// Helper function to update a node
export const updateNode = (setNodes: React.Dispatch<React.SetStateAction<any[]>>, task: ITask) => {
  setNodes((nds) =>
    nds.map((node) =>
      node.id === task.config.id ? { ...node, data: { ...node.data, task } } : node
    )
  );
};

export const cleanNodes = (setNodes: React.Dispatch<React.SetStateAction<any[]>>) => {
  setNodes((nds) => nds.map((node) => ({ ...node, data: { ...node.data } })));
};
export const cleanEdges = (setEdges: React.Dispatch<React.SetStateAction<any[]>>) => {
  setEdges((eds) => eds.map((edge) => ({ ...edge, data: { ...edge.data } })));
};
