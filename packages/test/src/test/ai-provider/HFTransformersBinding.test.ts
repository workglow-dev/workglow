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
  clearPipelineCache,
  HF_TRANSFORMERS_ONNX,
  type HfTransformersOnnxModelRecord,
  registerHuggingFaceTransformersInline,
} from "@workglow/ai-provider/hf-transformers/runtime";
import {
  ConcurrencyLimiter,
  JobQueueClient,
  JobQueueServer,
  RateLimiter,
} from "@workglow/job-queue";
import { Sqlite } from "@workglow/storage/sqlite";
import {
  InMemoryQueueStorage,
  JobStatus,
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
import { setLogger, sleep } from "@workglow/util";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

await Sqlite.init();
const db = new Sqlite.Database(":memory:");

async function waitForQueueActivity(
  client: JobQueueClient<AiJobInput<TaskInput>, TaskOutput>
): Promise<number> {
  let total = 0;
  for (let i = 0; i < 100; i++) {
    const [pending, processing, completed] = await Promise.all([
      client.size(JobStatus.PENDING),
      client.size(JobStatus.PROCESSING),
      client.size(JobStatus.COMPLETED),
    ]);
    total = pending + processing + completed;
    if (total > 0) break;
    await sleep(10);
  }
  return total;
}

describe("HFTransformersBinding", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  beforeEach(async () => {
    await setTaskQueueRegistry(null);
  });

  describe("InMemoryJobQueue", () => {
    it("Should use the pre-registered queue", async () => {
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
          limiter: new ConcurrencyLimiter(1),
          pollIntervalMs: 1,
        }
      );

      const client = new JobQueueClient<AiJobInput<TaskInput>, TaskOutput>({
        storage,
        queueName: HF_TRANSFORMERS_ONNX,
      });

      client.attach(server);
      // Register custom queue BEFORE the provider so QueuedExecutionStrategy.ensureQueue() finds it
      queueRegistry.registerQueue({ server, client, storage });
      clearPipelineCache();
      await registerHuggingFaceTransformersInline();

      const model: HfTransformersOnnxModelRecord = {
        model_id: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
        title: "LaMini-Flan-T5-783M",
        description: "LaMini-Flan-T5-783M",
        tasks: ["TextGenerationTask", "TextRewriterTask"],
        provider: HF_TRANSFORMERS_ONNX,
        provider_config: {
          pipeline: "text2text-generation",
          model_path: "Xenova/LaMini-Flan-T5-783M",
          dtype: "q8",
          device: "webgpu",
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
      // The provider should submit work to the pre-registered queue. Since
      // QueuedExecutionStrategy now starts an existing queue automatically,
      // the job may move from PENDING to PROCESSING/COMPLETED before we sample.
      const total = await waitForQueueActivity(registeredQueue!.client);
      expect(total).toBeGreaterThan(0);
      workflow.reset();
      await registeredQueue?.storage.deleteAll();
    });
  });

  describe("SqliteJobQueue", () => {
    it("Should use the pre-registered queue", async () => {
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
      // Register custom queue BEFORE the provider so QueuedExecutionStrategy.ensureQueue() finds it
      queueRegistry.registerQueue({ server, client, storage });

      await registerHuggingFaceTransformersInline();

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
          dtype: "q8",
          device: "webgpu",
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
      // The provider should submit work to the pre-registered queue. Since
      // QueuedExecutionStrategy now starts an existing queue automatically,
      // the job may move from PENDING to PROCESSING/COMPLETED before we sample.
      const total = await waitForQueueActivity(registeredQueue!.client);
      expect(total).toBeGreaterThan(0);
      workflow.reset();
      await registeredQueue?.storage.deleteAll();
    });
  });

  afterAll(async () => {
    await getTaskQueueRegistry().stopQueues();
    await getTaskQueueRegistry().clearQueues();
    await setTaskQueueRegistry(null);
  });
});
