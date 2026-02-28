/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AiJob,
  AiJobInput,
  getGlobalModelRepository,
  InMemoryModelRepository,
  setGlobalModelRepository,
} from "@workglow/ai";
import {
  HF_TRANSFORMERS_ONNX,
  type HfTransformersOnnxModelRecord,
  HuggingFaceTransformersProvider,
} from "@workglow/ai-provider";
import { clearPipelineCache, HFT_TASKS } from "@workglow/ai-provider/hf-transformers";
import {
  ConcurrencyLimiter,
  JobQueueClient,
  JobQueueServer,
  RateLimiter,
} from "@workglow/job-queue";
import { Sqlite } from "@workglow/sqlite";
import {
  InMemoryQueueStorage,
  SqliteQueueStorage,
  SqliteRateLimiterStorage,
} from "@workglow/storage";
import {
  getTaskQueueRegistry,
  setTaskQueueRegistry,
  TaskInput,
  TaskOutput,
  Workflow,
} from "@workglow/task-graph";
import { sleep, setLogger } from "@workglow/util";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

const db = new Sqlite.Database(":memory:");

describe("HFTransformersBinding", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  beforeEach(() => {
    setTaskQueueRegistry(null);
  });

  describe("InMemoryJobQueue", () => {
    it("Should have an item queued", async () => {
      const queueRegistry = getTaskQueueRegistry();

      const storage = new InMemoryQueueStorage<AiJobInput<TaskInput>, TaskOutput>(
        HF_TRANSFORMERS_ONNX
      );
      await storage.setupDatabase();

      const server = new JobQueueServer<AiJobInput<TaskInput>, TaskOutput>(
        AiJob<AiJobInput<TaskInput>, TaskOutput>,
        {
          storage,
          queueName: HF_TRANSFORMERS_ONNX,
          limiter: new ConcurrencyLimiter(1, 10),
          pollIntervalMs: 1,
        }
      );

      const client = new JobQueueClient<AiJobInput<TaskInput>, TaskOutput>({
        storage,
        queueName: HF_TRANSFORMERS_ONNX,
      });

      client.attach(server);
      clearPipelineCache();
      await new HuggingFaceTransformersProvider(HFT_TASKS).register({
        mode: "inline",
        queue: { autoCreate: false },
      });
      queueRegistry.registerQueue({ server, client, storage });

      const model: HfTransformersOnnxModelRecord = {
        model_id: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
        title: "LaMini-Flan-T5-783M",
        description: "LaMini-Flan-T5-783M",
        tasks: ["TextGenerationTask", "TextRewriterTask"],
        provider: HF_TRANSFORMERS_ONNX,
        provider_config: {
          pipeline: "text2text-generation",
          model_path: "Xenova/LaMini-Flan-T5-783M",
        },
        metadata: {},
      };

      setGlobalModelRepository(new InMemoryModelRepository());
      await getGlobalModelRepository().addModel(model);

      const registeredQueue = queueRegistry.getQueue(HF_TRANSFORMERS_ONNX);
      expect(registeredQueue).toBeDefined();
      expect(registeredQueue!.server.queueName).toEqual(HF_TRANSFORMERS_ONNX);

      const workflow = new Workflow();
      workflow.downloadModel({
        model: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
      });
      workflow.run().catch(() => {});
      // Poll until the job appears in the queue (the async chain from run() to
      // storage.add() includes multiple async hops that can't be reliably covered
      // by a fixed sleep duration)
      let size = 0;
      for (let i = 0; i < 100; i++) {
        size = (await registeredQueue?.client.size()) ?? 0;
        if (size > 0) break;
        await sleep(10);
      }
      expect(size).toEqual(1);
      workflow.reset();
      await registeredQueue?.storage.deleteAll();
    });
  });

  describe("SqliteJobQueue", () => {
    it("Should have an item queued", async () => {
      const queueRegistry = getTaskQueueRegistry();
      const storage = new SqliteQueueStorage<AiJobInput<TaskInput>, TaskOutput>(db, "test");
      await storage.setupDatabase();
      const limiterStorage = new SqliteRateLimiterStorage(db);
      await limiterStorage.setupDatabase();
      const limiter = new RateLimiter(limiterStorage, "test", {
        maxExecutions: 4,
        windowSizeInSeconds: 1,
      });

      const server = new JobQueueServer<AiJobInput<TaskInput>, TaskOutput>(
        AiJob<AiJobInput<TaskInput>, TaskOutput>,
        {
          storage,
          queueName: HF_TRANSFORMERS_ONNX,
          limiter,
          pollIntervalMs: 1,
        }
      );

      const client = new JobQueueClient<AiJobInput<TaskInput>, TaskOutput>({
        storage,
        queueName: HF_TRANSFORMERS_ONNX,
      });

      client.attach(server);

      await new HuggingFaceTransformersProvider(HFT_TASKS).register({
        mode: "inline",
        queue: { autoCreate: false },
      });
      queueRegistry.registerQueue({ server, client, storage });

      setGlobalModelRepository(new InMemoryModelRepository());
      const model: HfTransformersOnnxModelRecord = {
        model_id: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
        title: "LaMini-Flan-T5-783M",
        description: "LaMini-Flan-T5-783M",
        tasks: ["TextGenerationTask", "TextRewriterTask"],
        provider: HF_TRANSFORMERS_ONNX,
        provider_config: {
          pipeline: "text2text-generation",
          model_path: "Xenova/LaMini-Flan-T5-783M",
        },
        metadata: {},
      };

      await getGlobalModelRepository().addModel(model);

      const registeredQueue = queueRegistry.getQueue(HF_TRANSFORMERS_ONNX);
      expect(registeredQueue).toBeDefined();
      expect(registeredQueue?.server.queueName).toEqual(HF_TRANSFORMERS_ONNX);

      const workflow = new Workflow();
      workflow.downloadModel({
        model: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
      });
      workflow.run().catch(() => {});
      // Poll until the job appears in the queue (the async chain from run() to
      // storage.add() includes multiple async hops that can't be reliably covered
      // by a fixed sleep duration)
      let size = 0;
      for (let i = 0; i < 100; i++) {
        size = (await registeredQueue?.client.size()) ?? 0;
        if (size > 0) break;
        await sleep(10);
      }
      expect(size).toEqual(1);
      workflow.reset();
      await registeredQueue?.storage.deleteAll();
    });
  });

  afterAll(async () => {
    getTaskQueueRegistry().stopQueues().clearQueues();
    setTaskQueueRegistry(null);
  });
});
