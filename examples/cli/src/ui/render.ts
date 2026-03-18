/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskGraph } from "@workglow/task-graph";
import type { PromptFieldDescriptor } from "../input/prompt";
import type { SearchSelectItem, SearchSelectAppProps } from "./SearchSelectApp";
import { formatError, outputResult } from "../util";

export type { SearchSelectItem, SearchPage } from "./SearchSelectApp";

interface RenderOptions {
  readonly outputJsonFile?: string;
}

type TaskConstructor = new (
  input: Record<string, unknown>,
  config: Record<string, unknown>
) => {
  run(overrides?: Record<string, unknown>): Promise<unknown>;
  events: {
    on(event: string, fn: (...args: any[]) => void): void;
  };
};

export async function renderTaskRun(
  Ctor: TaskConstructor & { type: string },
  input: Record<string, unknown>,
  opts: RenderOptions & { readonly config?: Record<string, unknown> }
): Promise<void> {
  const React = await import("react");
  const { render } = await import("ink");
  const { TaskRunApp } = await import("./TaskRunApp");

  const task = new Ctor(input, opts.config ?? {});

  return new Promise<void>((resolve, reject) => {
    const onComplete = async (result: unknown) => {
      await outputResult(result, opts.outputJsonFile);
      instance.unmount();
      resolve();
    };

    const onError = (error: Error) => {
      instance.unmount();
      console.error(`\nError: ${formatError(error)}`);
      process.exit(1);
    };

    const instance = render(
      React.createElement(TaskRunApp, {
        task,
        taskType: Ctor.type,
        onComplete,
        onError,
      })
    );
  });
}

export async function renderWorkflowRun(
  graph: TaskGraph,
  input: Record<string, unknown>,
  opts: RenderOptions & { readonly config?: Record<string, unknown> }
): Promise<void> {
  const React = await import("react");
  const { render } = await import("ink");
  const { WorkflowRunApp } = await import("./WorkflowRunApp");

  return new Promise<void>((resolve, reject) => {
    const onComplete = async (result: unknown) => {
      await outputResult(result, opts.outputJsonFile);
      instance.unmount();
      resolve();
    };

    const onError = (error: Error) => {
      instance.unmount();
      console.error(`\nError: ${formatError(error)}`);
      process.exit(1);
    };

    const instance = render(
      React.createElement(WorkflowRunApp, {
        graph,
        input,
        config: opts.config,
        onComplete,
        onError,
      })
    );
  });
}

export async function renderSchemaPrompt(
  fields: readonly PromptFieldDescriptor[]
): Promise<Record<string, unknown>> {
  const React = await import("react");
  const { render } = await import("ink");
  const { SchemaPromptApp } = await import("./SchemaPromptApp");

  return new Promise<Record<string, unknown>>((resolve) => {
    const onComplete = (values: Record<string, unknown>) => {
      instance.unmount();
      resolve(values);
    };

    const instance = render(
      React.createElement(SchemaPromptApp, {
        fields,
        onComplete,
      })
    );
  });
}

export async function renderSearchSelect<T extends SearchSelectItem>(
  props: Omit<SearchSelectAppProps<T>, "onSelect" | "onCancel">
): Promise<T | undefined> {
  const React = await import("react");
  const { render } = await import("ink");
  const { SearchSelectApp } = await import("./SearchSelectApp");

  return new Promise<T | undefined>((resolve) => {
    const onSelect = (item: T) => {
      instance.unmount();
      resolve(item);
    };

    const onCancel = () => {
      instance.unmount();
      resolve(undefined);
    };

    const instance = render(
      React.createElement(SearchSelectApp as any, {
        ...props,
        onSelect,
        onCancel,
      })
    );
  });
}

export async function renderSelectPrompt(
  options: Array<{ label: string; value: string }>,
  message?: string
): Promise<string | undefined> {
  const React = await import("react");
  const { render } = await import("ink");
  const { SelectPromptApp } = await import("./SelectPromptApp");

  return new Promise<string | undefined>((resolve) => {
    const onSelect = (value: string) => {
      instance.unmount();
      resolve(value);
    };

    const onCancel = () => {
      instance.unmount();
      resolve(undefined);
    };

    const instance = render(
      React.createElement(SelectPromptApp, {
        message,
        options,
        onSelect,
        onCancel,
      })
    );
  });
}
