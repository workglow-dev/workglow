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
import { GOOGLE_GEMINI, GoogleGeminiProvider } from "@workglow/ai-provider";
import {
  GEMINI_REACTIVE_TASKS,
  GEMINI_STREAM_TASKS,
  GEMINI_TASKS,
} from "@workglow/ai-provider/google-gemini";
import { getTaskQueueRegistry, setTaskQueueRegistry } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";

import { getTestingLogger } from "../../binding/TestingLogger";
import { runGenericAiProviderTests } from "./genericAiProviderTests";

const RUN = !!process.env.GOOGLE_API_KEY || !!process.env.GEMINI_API_KEY;

const MODEL_ID = "gemini:gemini-2.0-flash";

runGenericAiProviderTests({
  name: "Google Gemini",
  skip: !RUN,
  setup: async () => {
    const logger = getTestingLogger();
    setLogger(logger);
    await setTaskQueueRegistry(null);
    setGlobalModelRepository(new InMemoryModelRepository());
    await new GoogleGeminiProvider(
      GEMINI_TASKS,
      GEMINI_STREAM_TASKS,
      GEMINI_REACTIVE_TASKS
    ).register({ mode: "inline" });

    await getGlobalModelRepository().addModel({
      model_id: MODEL_ID,
      title: "Gemini 2.0 Flash",
      description: "Google Gemini 2.0 Flash",
      tasks: [
        "TextGenerationTask",
        "TextRewriterTask",
        "TextSummaryTask",
        "StructuredGenerationTask",
        "ToolCallingTask",
      ],
      provider: GOOGLE_GEMINI as typeof GOOGLE_GEMINI,
      provider_config: { model_name: "gemini-2.0-flash" },
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
