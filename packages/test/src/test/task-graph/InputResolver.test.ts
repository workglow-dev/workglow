/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TypeTabularStorage } from "@workglow/dataset";
import {
  AnyTabularStorage,
  getGlobalTabularRepositories,
  InMemoryTabularStorage,
  registerTabularRepository,
} from "@workglow/storage";
import { IExecuteContext, resolveSchemaInputs, Task, TaskRegistry } from "@workglow/task-graph";
import {
  getInputResolvers,
  globalServiceRegistry,
  registerInputResolver,
  type DataPortSchema,
} from "@workglow/util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

describe("InputResolver", () => {
  // Test schema for tabular repository
  const testEntitySchema = {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
    },
    required: ["id", "name"],
    additionalProperties: false,
  } as const;

  let testDataset: InMemoryTabularStorage<typeof testEntitySchema, readonly ["id"]>;

  beforeEach(async () => {
    // Create and register a test repository
    testDataset = new InMemoryTabularStorage(testEntitySchema, ["id"] as const);
    await testDataset.setupDatabase();
    registerTabularRepository("test-dataset", testDataset);
  });

  afterEach(() => {
    // Clean up the registry
    getGlobalTabularRepositories().delete("test-dataset");
    testDataset.destroy();
  });

  describe("resolveSchemaInputs", () => {
    test("should pass through non-string values unchanged", async () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: {
          dataset: TypeTabularStorage(),
        },
      };

      const input = { dataset: testDataset };
      const resolved = await resolveSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(resolved.dataset).toBe(testDataset);
    });

    test("should resolve string dataset ID to instance", async () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: {
          dataset: TypeTabularStorage(),
        },
      };

      const input = { dataset: "test-dataset" };
      const resolved = await resolveSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(resolved.dataset).toBe(testDataset);
    });

    test("should throw error for unknown dataset ID", async () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: {
          dataset: TypeTabularStorage(),
        },
      };

      const input = { dataset: "non-existent-dataset" };

      await expect(
        resolveSchemaInputs(input, schema, { registry: globalServiceRegistry })
      ).rejects.toThrow('Tabular storage "non-existent-dataset" not found');
    });

    test("should not resolve properties without format annotation", async () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      };

      const input = { name: "test-name" };
      const resolved = await resolveSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(resolved.name).toBe("test-name");
    });

    test("should handle boolean schema", async () => {
      const input = { foo: "bar" };
      const resolved = await resolveSchemaInputs(input, true as DataPortSchema, {
        registry: globalServiceRegistry,
      });

      expect(resolved).toEqual(input);
    });

    test("should handle schema without properties", async () => {
      // @ts-expect-error - schema is not a DataPortSchemaObject
      const schema: DataPortSchema = { type: "object" };
      const input = { foo: "bar" };
      const resolved = await resolveSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(resolved).toEqual(input);
    });
  });

  describe("registerInputResolver", () => {
    test("should register custom resolver", async () => {
      // Register a custom resolver for a test format
      registerInputResolver("custom", (id, format, registry) => {
        return { resolved: true, id, format };
      });

      const schema: DataPortSchema = {
        type: "object",
        properties: {
          data: { type: "string", format: "custom:test" },
        },
      };

      const input = { data: "my-id" };
      const resolved = await resolveSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(resolved.data).toEqual({ resolved: true, id: "my-id", format: "custom:test" });

      // Clean up
      getInputResolvers().delete("custom");
    });

    test("should support async resolvers", async () => {
      registerInputResolver("async", async (id, format, registry) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { asyncResolved: true, id };
      });

      const schema: DataPortSchema = {
        type: "object",
        properties: {
          data: { type: "string", format: "async" },
        },
      };

      const input = { data: "async-id" };
      const resolved = await resolveSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(resolved.data).toEqual({ asyncResolved: true, id: "async-id" });

      // Clean up
      getInputResolvers().delete("async");
    });
  });

  describe("Integration with Task", () => {
    // Define a test task that uses a dataset
    class DatasetConsumerTask extends Task<
      { dataset: AnyTabularStorage | string; query: string },
      { results: any[] }
    > {
      public static type = "DatasetConsumerTask";

      public static inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: {
            dataset: TypeTabularStorage({
              title: "Data Storage",
              description: "Storage to query",
            }),
            query: { type: "string", title: "Query" },
          },
          required: ["dataset", "query"],
          additionalProperties: false,
        };
      }

      public static outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: {
            results: { type: "array", items: { type: "object" } },
          },
          required: ["results"],
          additionalProperties: false,
        };
      }

      async execute(
        input: { dataset: AnyTabularStorage; query: string },
        _context: IExecuteContext
      ): Promise<{ results: any[] }> {
        const { dataset } = input;
        // In a real task, we'd search the dataset
        const results = await dataset.getAll();
        return { results: results ?? [] };
      }
    }

    beforeEach(() => {
      TaskRegistry.registerTask(DatasetConsumerTask);
    });

    afterEach(() => {
      TaskRegistry.all.delete(DatasetConsumerTask.type);
    });

    test("should resolve dataset when running task with string ID", async () => {
      // Add some test data
      await testDataset.put({ id: "1", name: "Test Item" });

      const task = new DatasetConsumerTask();
      const result = await task.run({
        dataset: "test-dataset",
        query: "test",
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toEqual({ id: "1", name: "Test Item" });
    });

    test("should work with direct dataset instance", async () => {
      await testDataset.put({ id: "2", name: "Direct Item" });

      const task = new DatasetConsumerTask();
      const result = await task.run({
        dataset: testDataset,
        query: "test",
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toEqual({ id: "2", name: "Direct Item" });
    });
  });
});
