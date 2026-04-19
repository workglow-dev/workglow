/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IHumanConnector, IHumanRequest, IHumanResponse } from "@workglow/util";
import { getCliHumanInteractionEnqueue } from "../cliHumanBridge";

function notHostedError(): Error {
  return new Error(
    "Human-in-the-loop tasks require the Ink CLI run UI (TTY). Non-interactive runs cannot prompt."
  );
}

/**
 * {@link IHumanConnector} that renders via the active {@link HumanInteractionHost} inside workflow/task Ink UI.
 */
export class InkHumanConnector implements IHumanConnector {
  async send(request: IHumanRequest, signal: AbortSignal): Promise<IHumanResponse> {
    const enqueue = getCliHumanInteractionEnqueue();
    if (!enqueue) {
      throw notHostedError();
    }
    return enqueue(request, signal);
  }

  async followUp(
    request: IHumanRequest,
    _previousResponse: IHumanResponse,
    signal: AbortSignal
  ): Promise<IHumanResponse> {
    return this.send(request, signal);
  }
}
