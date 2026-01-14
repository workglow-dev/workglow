/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { DefaultKeyValueSchema, IKvStorage } from "@workglow/storage";
import { FromSchema, JsonSchema } from "@workglow/util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

export function runGenericKvRepositoryTests(
  createRepository: (keyType: JsonSchema, valueType: JsonSchema) => Promise<IKvStorage<any, any>>
) {
  describe("with default schemas (key and value)", () => {
    let repository: IKvStorage<
      FromSchema<typeof DefaultKeyValueSchema.properties.key>,
      FromSchema<typeof DefaultKeyValueSchema.properties.value>
    >;

    beforeEach(async () => {
      repository = await createRepository({ type: "string" }, {});
      await (repository as any).setupDatabase?.();
    });

    afterEach(async () => {});

    it("should store and retrieve values for a key", async () => {
      const key = "key1";
      const value = "value1";
      await repository.put(key, value);
      const output = await repository.get(key);

      expect(output).toEqual(value);
    });

    it("should get undefined for a key that doesn't exist", async () => {
      const key = "key";
      const value = "value";
      await repository.put(key, value);
      const output = await repository.get("not-a-key");

      expect(output == undefined).toEqual(true);
    });

    it("should store multiple values using putBulk", async () => {
      const items = [
        { key: "key1", value: "value1" },
        { key: "key2", value: "value2" },
        { key: "key3", value: "value3" },
      ];

      await repository.putBulk(items);

      for (const item of items) {
        const output = await repository.get(item.key);
        expect(output).toEqual(item.value);
      }
    });

    it("should handle empty array in putBulk", async () => {
      await repository.putBulk([]);
      // Should not throw an error
    });
  });

  describe("with json value", () => {
    let repository: IKvStorage<string, { option: string; success: boolean }>;

    beforeEach(async () => {
      repository = (await createRepository(
        { type: "string" },
        {
          type: "object",
          properties: {
            option: { type: "string" },
            success: { type: "boolean" },
          },
          additionalProperties: false,
        }
      )) as IKvStorage<string, { option: string; success: boolean }>;
      await (repository as any).setupDatabase?.();
    });

    it("should store and retrieve values for a key", async () => {
      const key = await repository.getObjectAsIdString({ name: "key1", type: "string1" });
      const value = { option: "value1", success: true };
      await repository.put(key, value);
      const output = await repository.get(key);

      expect(output?.option).toEqual("value1");
      expect(!!output?.success).toEqual(true);
    });

    it("should get undefined for a key that doesn't exist", async () => {
      const key = await repository.getObjectAsIdString({ name: "key", type: "string" });
      const output = await repository.get(key);

      expect(output == undefined).toEqual(true);
    });

    it("should store multiple JSON values using putBulk", async () => {
      const items = [
        {
          key: await repository.getObjectAsIdString({ name: "key1", type: "string1" }),
          value: { option: "value1", success: true },
        },
        {
          key: await repository.getObjectAsIdString({ name: "key2", type: "string2" }),
          value: { option: "value2", success: false },
        },
        {
          key: await repository.getObjectAsIdString({ name: "key3", type: "string3" }),
          value: { option: "value3", success: true },
        },
      ];

      await repository.putBulk(items);

      for (const item of items) {
        const output = await repository.get(item.key);
        expect(output?.option).toEqual(item.value.option);
        expect(output?.success).toEqual(item.value.success);
      }
    });
  });
}
