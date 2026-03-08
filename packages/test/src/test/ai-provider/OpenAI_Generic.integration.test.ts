/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getGlobalModelRepository,
  InMemoryModelRepository,
  setGlobalModelRepository,
} from "@workglow/ai";
import { OPENAI, OpenAiProvider } from "@workglow/ai-provider";
import {
  OPENAI_REACTIVE_TASKS,
  OPENAI_STREAM_TASKS,
  OPENAI_TASKS,
} from "@workglow/ai-provider/openai";
import { getTaskQueueRegistry, setTaskQueueRegistry } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";

import { getTestingLogger } from "../../binding/TestingLogger";
import { runGenericAiProviderTests } from "./genericAiProviderTests";

const RUN = !!process.env.OPENAI_API_KEY;

const MODEL_ID = "openai:gpt-4o-mini";

runGenericAiProviderTests({
  name: "OpenAI",
  skip: !RUN,
  setup: async () => {
    const logger = getTestingLogger();
    setLogger(logger);
    await setTaskQueueRegistry(null);
    setGlobalModelRepository(new InMemoryModelRepository());
    await new OpenAiProvider(OPENAI_TASKS, OPENAI_STREAM_TASKS, OPENAI_REACTIVE_TASKS).register({
      mode: "inline",
    });

    await getGlobalModelRepository().addModel({
      model_id: MODEL_ID,
      title: "GPT-4o Mini",
      description: "OpenAI GPT-4o Mini",
      tasks: [
        "TextGenerationTask",
        "TextRewriterTask",
        "TextSummaryTask",
        "StructuredGenerationTask",
        "ToolCallingTask",
      ],
      provider: OPENAI as typeof OPENAI,
      provider_config: { model_name: "gpt-4o-mini" },
      metadata: {},
    });
  },
  teardown: async () => {
    await getTaskQueueRegistry().stopQueues();
    await getTaskQueueRegistry().clearQueues();
    await setTaskQueueRegistry(null);
  },
  textGenerationModel: MODEL_ID,
  toolCallingModel: MODEL_ID,
  structuredGenerationModel: MODEL_ID,
  maxTokens: 100,
  timeout: 30000,
});
