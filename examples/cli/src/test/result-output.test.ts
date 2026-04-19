/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Command } from "commander";
import type { Mock } from "vitest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

class EchoTask {
  static readonly type = "EchoTask";
  static readonly category = "Test";

  static inputSchema(): Record<string, unknown> {
    return { type: "object", properties: {} };
  }

  constructor(_config: Record<string, unknown>) {}
}

const stdoutIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
const stdinIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

interface TestMocks {
  readonly taskRegistry: Map<string, unknown>;
  readonly graph: {
    readonly getTasks: ReturnType<typeof vi.fn>;
    readonly getSourceDataflows: ReturnType<typeof vi.fn>;
  };
  readonly repo: {
    readonly setupDatabase: ReturnType<typeof vi.fn>;
    readonly getTaskGraph: ReturnType<typeof vi.fn>;
    readonly tabularRepository: {
      readonly getAll: ReturnType<typeof vi.fn>;
      readonly get: ReturnType<typeof vi.fn>;
      readonly delete: ReturnType<typeof vi.fn>;
    };
    readonly saveTaskGraph: ReturnType<typeof vi.fn>;
  };
  readonly taskRun: Mock<(...args: unknown[]) => Promise<unknown>>;
  readonly workflowRun: Mock<(...args: unknown[]) => Promise<unknown>>;
  readonly outputResult: Mock<(result: unknown, outputJsonFile?: string) => Promise<void>>;
  readonly loadConfig: ReturnType<typeof vi.fn>;
  readonly registerCliBrowserDeps: ReturnType<typeof vi.fn>;
  readonly ensureCredentialStoreUnlocked: ReturnType<typeof vi.fn>;
  readonly resolveInput: ReturnType<typeof vi.fn>;
  readonly resolveConfig: ReturnType<typeof vi.fn>;
  readonly parseDynamicFlags: ReturnType<typeof vi.fn>;
  readonly parseConfigFlags: ReturnType<typeof vi.fn>;
  readonly validateInput: ReturnType<typeof vi.fn>;
  readonly promptMissingInput: ReturnType<typeof vi.fn>;
  readonly promptEditableInput: ReturnType<typeof vi.fn>;
  readonly renderSelectPrompt: ReturnType<typeof vi.fn>;
}

function setTty(stdinIsTTY: boolean, stdoutIsTTY: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: stdinIsTTY });
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: stdoutIsTTY });
}

function createMocks(): TestMocks {
  const taskRegistry = new Map<string, unknown>();
  const graph = {
    getTasks: vi.fn(() => []),
    getSourceDataflows: vi.fn(() => []),
  };
  return {
    taskRegistry,
    graph,
    repo: {
      setupDatabase: vi.fn(async () => {}),
      getTaskGraph: vi.fn(async () => graph),
      tabularRepository: {
        getAll: vi.fn(async () => []),
        get: vi.fn(async () => undefined),
        delete: vi.fn(async () => {}),
      },
      saveTaskGraph: vi.fn(async () => {}),
    },
    taskRun: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ ok: "task" })),
    workflowRun: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
      ok: "workflow",
    })),
    outputResult: vi.fn<(result: unknown, outputJsonFile?: string) => Promise<void>>(
      async () => {}
    ),
    loadConfig: vi.fn(async () => ({ directories: {} })),
    registerCliBrowserDeps: vi.fn(async () => {}),
    ensureCredentialStoreUnlocked: vi.fn(async () => {}),
    resolveInput: vi.fn(async () => ({})),
    resolveConfig: vi.fn(async () => ({})),
    parseDynamicFlags: vi.fn(() => ({})),
    parseConfigFlags: vi.fn(() => ({})),
    validateInput: vi.fn(() => ({ valid: true, errors: [] })),
    promptMissingInput: vi.fn(async (input: Record<string, unknown>) => input),
    promptEditableInput: vi.fn(async (input: Record<string, unknown>) => input),
    renderSelectPrompt: vi.fn(async () => undefined),
  };
}

async function loadCommands(): Promise<{
  readonly mocks: TestMocks;
  readonly registerTaskCommand: (program: Command) => void;
  readonly registerWorkflowCommand: (program: Command) => void;
}> {
  const mocks = createMocks();

  vi.doMock("@workglow/task-graph", () => {
    class TaskGraph {}

    return {
      TaskGraph,
      TaskRegistry: {
        all: mocks.taskRegistry,
      },
      computeGraphInputSchema: vi.fn(() => ({ type: "object", properties: {} })),
      createGraphFromGraphJSON: vi.fn(),
      scanGraphForCredentials: vi.fn(() => ({ needsCredentials: false })),
    };
  });

  vi.doMock("../input", () => ({
    generateConfigHelpText: vi.fn(() => "  (no config properties)"),
    generateSchemaHelpText: vi.fn(() => "  (no input properties)"),
    parseConfigFlags: mocks.parseConfigFlags,
    parseDynamicFlags: mocks.parseDynamicFlags,
    readJsonInput: vi.fn(),
    resolveConfig: mocks.resolveConfig,
    resolveInput: mocks.resolveInput,
    validateInput: mocks.validateInput,
  }));

  vi.doMock("../input/prompt", () => ({
    promptEditableInput: mocks.promptEditableInput,
    promptMissingInput: mocks.promptMissingInput,
  }));

  vi.doMock("../input/resolve-input", () => ({
    deepMerge: (
      left: Record<string, unknown>,
      right: Record<string, unknown>
    ): Record<string, unknown> => ({ ...left, ...right }),
  }));

  vi.doMock("../run-interactive", () => ({
    withCli: (value: unknown) => ({
      run:
        value === mocks.graph
          ? (...args: unknown[]) => mocks.workflowRun(...args)
          : (...args: unknown[]) => mocks.taskRun(...args),
    }),
  }));

  vi.doMock("../util", async () => {
    const actual = await vi.importActual<typeof import("../util")>("../util");
    return {
      ...actual,
      outputResult: mocks.outputResult,
    };
  });

  vi.doMock("../config", () => ({
    loadConfig: mocks.loadConfig,
  }));

  vi.doMock("../storage", () => ({
    createWorkflowRepository: vi.fn(() => mocks.repo),
  }));

  vi.doMock("../browser", () => ({
    registerCliBrowserDeps: mocks.registerCliBrowserDeps,
  }));

  vi.doMock("../keyring", () => ({
    ensureCredentialStoreUnlocked: mocks.ensureCredentialStoreUnlocked,
  }));

  vi.doMock("../ui/render", () => ({
    renderSelectPrompt: mocks.renderSelectPrompt,
  }));

  const taskModule = await import("../commands/task");
  const workflowModule = await import("../commands/workflow");

  return {
    mocks,
    registerTaskCommand: taskModule.registerTaskCommand,
    registerWorkflowCommand: workflowModule.registerWorkflowCommand,
  };
}

async function parseCommand(args: string[], register: (program: Command) => void): Promise<void> {
  const program = new Command();
  register(program);
  await program.parseAsync(args, { from: "user" });
}

describe("CLI result output policy", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterAll(() => {
    if (stdinIsTTYDescriptor) {
      Object.defineProperty(process.stdin, "isTTY", stdinIsTTYDescriptor);
    }
    if (stdoutIsTTYDescriptor) {
      Object.defineProperty(process.stdout, "isTTY", stdoutIsTTYDescriptor);
    }
  });

  it("task run does not print final JSON when stdout is a TTY", async () => {
    setTty(false, true);
    const { mocks, registerTaskCommand } = await loadCommands();
    mocks.taskRegistry.set("EchoTask", EchoTask);

    await parseCommand(["task", "run", "EchoTask"], registerTaskCommand);

    expect(mocks.outputResult).not.toHaveBeenCalled();
  });

  it("task run still writes output when stdout is not a TTY", async () => {
    setTty(false, false);
    const { mocks, registerTaskCommand } = await loadCommands();
    mocks.taskRegistry.set("EchoTask", EchoTask);

    await parseCommand(["task", "run", "EchoTask"], registerTaskCommand);

    expect(mocks.outputResult).toHaveBeenCalledWith({ ok: "task" }, undefined);
  });

  it("workflow run still writes output file in TTY mode", async () => {
    setTty(false, true);
    const { mocks, registerWorkflowCommand } = await loadCommands();

    await parseCommand(
      ["workflow", "run", "demo", "--output-json-file", "/tmp/workflow-output.json"],
      registerWorkflowCommand
    );

    expect(mocks.outputResult).toHaveBeenCalledWith(
      { ok: "workflow" },
      "/tmp/workflow-output.json"
    );
  });
});
