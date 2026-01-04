/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getGlobalTabularRepositories,
  InMemoryTabularRepository,
  registerTabularRepository,
  TypeTabularRepository,
} from "@workglow/storage";
import {
  getInputResolvers,
  registerInputResolver,
  resolveSchemaInputs,
  Task,
  TaskRegistry,
} from "@workglow/task-graph";
import { globalServiceRegistry, type DataPortSchema } from "@workglow/util";
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

  let testRepo: InMemoryTabularRepository<typeof testEntitySchema, readonly ["id"]>;

  beforeEach(async () => {
    // Create and register a test repository
    testRepo = new InMemoryTabularRepository(testEntitySchema, ["id"] as const);
    await testRepo.setupDatabase();
    registerTabularRepository("test-repo", testRepo);
  });

  afterEach(() => {
    // Clean up the registry
    getGlobalTabularRepositories().delete("test-repo");
    testRepo.destroy();
  });

  describe("resolveSchemaInputs", () => {
    test("should pass through non-string values unchanged", async () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: {
          repository: TypeTabularRepository(),
        },
      };

      const input = { repository: testRepo };
      const resolved = await resolveSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(resolved.repository).toBe(testRepo);
    });

    test("should resolve string repository ID to instance", async () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: {
          repository: TypeTabularRepository(),
        },
      };

      const input = { repository: "test-repo" };
      const resolved = await resolveSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(resolved.repository).toBe(testRepo);
    });

    test("should throw error for unknown repository ID", async () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: {
          repository: TypeTabularRepository(),
        },
      };

      const input = { repository: "non-existent-repo" };

      await expect(
        resolveSchemaInputs(input, schema, { registry: globalServiceRegistry })
      ).rejects.toThrow('Tabular repository "non-existent-repo" not found');
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
    // Define a test task that uses a repository
    class RepositoryConsumerTask extends Task<
      { repository: any; query: string },
      { results: any[] }
    > {
      public static type = "RepositoryConsumerTask";

      public static inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: {
            repository: TypeTabularRepository({
              title: "Data Repository",
              description: "Repository to query",
            }),
            query: { type: "string", title: "Query" },
          },
          required: ["repository", "query"],
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

      async executeReactive(): Promise<{ results: any[] }> {
        const { repository, query } = this.runInputData;
        // In a real task, we'd search the repository
        const results = await repository.getAll();
        return { results: results ?? [] };
      }
    }

    beforeEach(() => {
      TaskRegistry.registerTask(RepositoryConsumerTask);
    });

    afterEach(() => {
      TaskRegistry.all.delete(RepositoryConsumerTask.type);
    });

    test("should resolve repository when running task with string ID", async () => {
      // Add some test data
      await testRepo.put({ id: "1", name: "Test Item" });

      const task = new RepositoryConsumerTask();
      const result = await task.run({
        repository: "test-repo",
        query: "test",
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toEqual({ id: "1", name: "Test Item" });
    });

    test("should work with direct repository instance", async () => {
      await testRepo.put({ id: "2", name: "Direct Item" });

      const task = new RepositoryConsumerTask();
      const result = await task.run({
        repository: testRepo,
        query: "test",
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toEqual({ id: "2", name: "Direct Item" });
    });
  });
});
