/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Dataflow, TaskStatus } from "@workglow/task-graph";
import { BaseEdge, Edge, EdgeLabelRenderer, EdgeProps, getBezierPath } from "@xyflow/react";
import { useEffect, useState } from "react";
import { DataDialog } from "../components/DataDialog";
import { getStatusColorBg } from "./util";

export type DataflowEdgeData = {
  dataflow: Dataflow;
};

type EdgeStrokeStyle = {
  stroke: string;
  strokeWidth: number;
  transition: string;
  strokeDasharray?: string;
};

// Edge style options for each status
const EDGE_STYLE_MAP: Record<TaskStatus, EdgeStrokeStyle> = {
  [TaskStatus.PROCESSING]: {
    stroke: "url(#edge-gradient)",
    strokeWidth: 2,
    strokeDasharray: "3 3",
    transition: "stroke 0.3s",
  },
  [TaskStatus.STREAMING]: {
    stroke: "url(#edge-gradient)",
    strokeWidth: 2,
    strokeDasharray: "3 3",
    transition: "stroke 0.3s",
  },
  [TaskStatus.COMPLETED]: {
    stroke: "#2ecc71",
    strokeWidth: 2,
    transition: "stroke 0.3s",
  },
  [TaskStatus.FAILED]: {
    stroke: "#e74c3c",
    strokeWidth: 2,
    transition: "stroke 0.3s",
  },
  [TaskStatus.ABORTING]: {
    stroke: "#e74c3c",
    strokeWidth: 2,
    transition: "stroke 0.3s",
  },
  [TaskStatus.DISABLED]: {
    stroke: "#bbb",
    strokeWidth: 1.5,
    transition: "stroke 0.3s",
  },
  [TaskStatus.PENDING]: {
    stroke: "#bbb",
    strokeWidth: 1.5,
    transition: "stroke 0.3s",
  },
};

function isFlowingStatus(status: TaskStatus): boolean {
  return status === TaskStatus.PROCESSING || status === TaskStatus.STREAMING;
}

export function DataflowEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style = {},
  markerEnd,
}: EdgeProps<Edge<DataflowEdgeData, string>>) {
  const [status, setStatus] = useState<TaskStatus>(data?.dataflow?.status || TaskStatus.PENDING);
  const [animatedDashOffset, setAnimatedDashOffset] = useState(0);
  type EdgePathParams = [string, { strokePath: string }];
  const [edgePathParams, setEdgePathParams] = useState<EdgePathParams | null>(null);
  const [showDataDialog, setShowDataDialog] = useState(false);

  useEffect(() => {
    // Update status from data
    if (data?.dataflow?.status) {
      setStatus(data.dataflow.status);
    }
  }, [data]);

  useEffect(() => {
    // Calculate path once
    const [edgePath] = getBezierPath({
      sourceX: sourceX - 10,
      sourceY,
      sourcePosition,
      targetX: targetX + 10,
      targetY,
      targetPosition,
    });

    setEdgePathParams([edgePath, { strokePath: edgePath }]);
  }, [sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition]);

  useEffect(() => {
    // Animate the flow when status is 'flowing'
    if (isFlowingStatus(status)) {
      const interval = setInterval(() => {
        setAnimatedDashOffset((prev) => (prev - 1) % 20);
      }, 50);

      return () => clearInterval(interval);
    }
  }, [status]);

  if (!edgePathParams) {
    return null;
  }

  const [edgePath] = edgePathParams;

  // Get the base style for current status
  const baseStyle = EDGE_STYLE_MAP[status];

  // Add animated dash offset for flowing status
  const statusStyle = isFlowingStatus(status)
    ? { ...baseStyle, strokeDashoffset: animatedDashOffset }
    : baseStyle;

  const edgeStyles = { ...style, ...statusStyle };

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={edgeStyles} />

      {/* Data particle effect for flowing data */}
      {isFlowingStatus(status) && (
        <>
          <circle
            cx={0}
            cy={0}
            r={3}
            fill="#3498db"
            className="data-particle"
            style={{
              offsetPath: `path('${edgePath}')`,
            }}
          />
          <circle
            cx={0}
            cy={0}
            r={3}
            fill="#e74c3c"
            className="data-particle"
            style={{
              offsetPath: `path('${edgePath}')`,
              animationDelay: "0.7s",
            }}
          />
        </>
      )}

      {/* Data label for completed edges with data */}
      {data?.dataflow?.value && (
        <>
          <foreignObject
            width={80}
            height={20}
            x={(sourceX + targetX) / 2 - 40}
            y={(sourceY + targetY) / 2 - 10}
            style={{
              fontSize: "10px",
              textAlign: "center",
              pointerEvents: "none",
            }}
          >
            <span
              onClick={() => setShowDataDialog(true)}
              className={`ml-2 text-xs px-1.5 rounded-full mr-2 border border-blue-800 ${getStatusColorBg(
                status
              )}`}
              style={{ pointerEvents: "all", cursor: "pointer" }}
            >
              ⧉
            </span>
          </foreignObject>
          <EdgeLabelRenderer>
            {showDataDialog && (
              <DataDialog
                isOpen={showDataDialog}
                onClose={() => setShowDataDialog(false)}
                data={data.dataflow.value}
                title={`Dataflow - ${data.dataflow.id}`}
              />
            )}
          </EdgeLabelRenderer>
        </>
      )}
    </>
  );
}
