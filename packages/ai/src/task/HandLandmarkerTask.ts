/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, JobQueueTaskConfig, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";
import { TypeImageInput, TypeModel } from "./base/AiTaskSchemas";
import { AiVisionTask } from "./base/AiVisionTask";

const modelSchema = TypeModel("model:HandLandmarkerTask");

/**
 * A landmark point with x, y, z coordinates.
 */
const TypeLandmark = {
  type: "object",
  properties: {
    x: {
      type: "number",
      title: "X Coordinate",
      description: "X coordinate normalized to [0.0, 1.0]",
    },
    y: {
      type: "number",
      title: "Y Coordinate",
      description: "Y coordinate normalized to [0.0, 1.0]",
    },
    z: {
      type: "number",
      title: "Z Coordinate",
      description: "Z coordinate (depth)",
    },
  },
  required: ["x", "y", "z"],
  additionalProperties: false,
} as const;

/**
 * Handedness classification (left or right hand).
 */
const TypeHandedness = {
  type: "object",
  properties: {
    label: {
      type: "string",
      title: "Hand Label",
      description: "Whether the hand is 'Left' or 'Right'",
    },
    score: {
      type: "number",
      title: "Confidence Score",
      description: "Confidence score for the handedness classification",
    },
  },
  required: ["label", "score"],
  additionalProperties: false,
} as const;

/**
 * Detection result for a single hand.
 */
const TypeHandDetection = {
  type: "object",
  properties: {
    handedness: {
      type: "array",
      items: TypeHandedness,
      title: "Handedness",
      description: "Handedness classification (left/right)",
    },
    landmarks: {
      type: "array",
      items: TypeLandmark,
      title: "Landmarks",
      description: "21 hand landmarks in image coordinates",
    },
    worldLandmarks: {
      type: "array",
      items: TypeLandmark,
      title: "World Landmarks",
      description: "21 hand landmarks in 3D world coordinates (meters)",
    },
  },
  required: ["handedness", "landmarks", "worldLandmarks"],
  additionalProperties: false,
} as const;

export const HandLandmarkerInputSchema = {
  type: "object",
  properties: {
    image: TypeImageInput,
    model: modelSchema,
    numHands: {
      type: "number",
      minimum: 1,
      maximum: 10,
      default: 1,
      title: "Number of Hands",
      description: "The maximum number of hands to detect",
      "x-ui-group": "Configuration",
    },
    minHandDetectionConfidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      default: 0.5,
      title: "Min Hand Detection Confidence",
      description: "Minimum confidence score for hand detection",
      "x-ui-group": "Configuration",
    },
    minHandPresenceConfidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      default: 0.5,
      title: "Min Hand Presence Confidence",
      description: "Minimum confidence score for hand presence",
      "x-ui-group": "Configuration",
    },
    minTrackingConfidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      default: 0.5,
      title: "Min Tracking Confidence",
      description: "Minimum confidence score for hand tracking",
      "x-ui-group": "Configuration",
    },
  },
  required: ["image", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const HandLandmarkerOutputSchema = {
  type: "object",
  properties: {
    hands: {
      oneOf: [
        { type: "array", items: TypeHandDetection },
        { type: "array", items: { type: "array", items: TypeHandDetection } },
      ],
      title: "Hand Detections",
      description: "Detected hands with handedness and landmarks",
    },
  },
  required: ["hands"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type HandLandmarkerTaskInput = FromSchema<typeof HandLandmarkerInputSchema>;
export type HandLandmarkerTaskOutput = FromSchema<typeof HandLandmarkerOutputSchema>;

/**
 * Detects hand landmarks in images using MediaPipe Hand Landmarker.
 * Identifies 21 hand landmarks and classifies left vs. right hands.
 */
export class HandLandmarkerTask extends AiVisionTask<
  HandLandmarkerTaskInput,
  HandLandmarkerTaskOutput,
  JobQueueTaskConfig
> {
  public static type = "HandLandmarkerTask";
  public static category = "AI Vision Model";
  public static title = "Hand Landmarker";
  public static description =
    "Detects hand landmarks in images. Identifies 21 hand landmarks and classifies left vs. right hands.";
  public static inputSchema(): DataPortSchema {
    return HandLandmarkerInputSchema as DataPortSchema;
  }
  public static outputSchema(): DataPortSchema {
    return HandLandmarkerOutputSchema as DataPortSchema;
  }
}


/**
 * Convenience function to run hand landmark detection tasks.
 * Creates and executes a HandLandmarkerTask with the provided input.
 * @param input The input parameters for hand landmark detection (image, model, and optional configuration)
 * @returns Promise resolving to the detected hand landmarks and handedness
 */
export const handLandmarker = (input: HandLandmarkerTaskInput, config?: JobQueueTaskConfig) => {
  return new HandLandmarkerTask({} as HandLandmarkerTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    handLandmarker: CreateWorkflow<
      HandLandmarkerTaskInput,
      HandLandmarkerTaskOutput,
      JobQueueTaskConfig
    >;
  }
}

Workflow.prototype.handLandmarker = CreateWorkflow(HandLandmarkerTask);
