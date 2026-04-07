/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IHumanRequest, IHumanResponse } from "@workglow/tasks";

export type CliHumanInteractionEnqueue = (
  request: IHumanRequest,
  signal: AbortSignal
) => Promise<IHumanResponse>;

let enqueue: CliHumanInteractionEnqueue | undefined;

/**
 * Installed by {@link HumanInteractionHost} while the Ink run UI is mounted.
 * {@link InkHumanConnector} delegates here so human/credential-style prompts share the same Ink tree as workflow progress.
 */
export function setCliHumanInteractionEnqueue(fn: CliHumanInteractionEnqueue | undefined): void {
  enqueue = fn;
}

export function getCliHumanInteractionEnqueue(): CliHumanInteractionEnqueue | undefined {
  return enqueue;
}
