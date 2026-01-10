/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BaseTabularRepository } from "../tabular/BaseTabularRepository";
import { DefaultKeyValueKey, DefaultKeyValueSchema } from "./IKvRepository";
import { KvRepository } from "./KvRepository";

/**
 * Abstract base class for key-value storage repositories that uses a tabular repository for storage.
 * Has a basic event emitter for listening to repository events.
 *
 * @template Key - The type of the primary key
 * @template Value - The type of the value being stored
 * @template Combined - Combined type of Key & Value
 */
export abstract class KvViaTabularRepository<
  Key extends string = string,
  Value extends any = any,
  Combined = { key: Key; value: Value },
> extends KvRepository<Key, Value, Combined> {
  public abstract tabularRepository: BaseTabularRepository<
    typeof DefaultKeyValueSchema,
    typeof DefaultKeyValueKey
  >;

  /**
   * Sets up the database for the repository.
   * Must be called before using any other methods.
   */
  public async setupDatabase(): Promise<void> {
    await this.tabularRepository.setupDatabase?.();
  }

  /**
   * Stores a row in the repository.
   * @param key - The primary key
   * @param value - The value to store
   */
  public async put(key: Key, value: Value): Promise<void> {
    // Handle objects that need to be JSON-stringified, TODO(str): should put in the type
    const schemaType =
      typeof this.valueSchema === "object" &&
      this.valueSchema !== null &&
      "type" in this.valueSchema
        ? this.valueSchema.type
        : undefined;
    const shouldStringify = !["number", "boolean", "string", "blob"].includes(schemaType as string);

    if (shouldStringify) {
      value = JSON.stringify(value) as Value;
    }
    await this.tabularRepository.put({ key, value });
  }

  /**
   * Stores multiple rows in the repository in a bulk operation.
   * @param items - Array of key-value pairs to store
   */
  public async putBulk(items: Array<{ key: Key; value: Value }>): Promise<void> {
    // Handle objects that need to be JSON-stringified, TODO(str): should put in the type
    const schemaType =
      typeof this.valueSchema === "object" &&
      this.valueSchema !== null &&
      "type" in this.valueSchema
        ? this.valueSchema.type
        : undefined;
    const shouldStringify = !["number", "boolean", "string", "blob"].includes(schemaType as string);

    const entities = items.map(({ key, value }) => {
      if (shouldStringify) {
        value = JSON.stringify(value) as Value;
      }
      return { key, value };
    });

    await this.tabularRepository.putBulk(entities);
  }

  /**
   * Retrieves a value by its key.
   * This is a convenience method that automatically converts simple types to structured format if using default schema.
   *
   * @param key - Primary key to look up (basic key like default schema)
   * @returns The stored value or undefined if not found
   */
  public async get(key: Key): Promise<Value | undefined> {
    const result = await this.tabularRepository.get({ key });
    if (result) {
      const schemaType =
        typeof this.valueSchema === "object" &&
        this.valueSchema !== null &&
        "type" in this.valueSchema
          ? this.valueSchema.type
          : undefined;
      const shouldParse = !["number", "boolean", "string", "blob"].includes(schemaType as string);

      if (shouldParse) {
        try {
          return JSON.parse(result.value as unknown as string) as Value;
        } catch (e) {
          return result.value as unknown as Value;
        }
      } else {
        return result.value as unknown as Value;
      }
    } else {
      return undefined;
    }
  }

  /**
   * Deletes a row from the repository.
   * @param key - The primary key of the row to delete
   */
  public async delete(key: Key): Promise<void> {
    return await this.tabularRepository.delete({ key });
  }

  /**
   * Retrieves all rows from the repository.
   * @returns An array of all rows in the repository or undefined if empty
   */
  public async getAll(): Promise<Combined[] | undefined> {
    const values = await this.tabularRepository.getAll();
    if (values) {
      return values.map(
        (value) =>
          ({
            key: value.key,
            value: (() => {
              const schemaType =
                typeof this.valueSchema === "object" &&
                this.valueSchema !== null &&
                "type" in this.valueSchema
                  ? this.valueSchema.type
                  : undefined;
              const shouldParse = !["number", "boolean", "string"].includes(schemaType as string);

              if (shouldParse && typeof value.value === "string") {
                try {
                  return JSON.parse(value.value);
                } catch (e) {
                  return value.value;
                }
              }
              return value.value;
            })(),
          }) as Combined
      );
    }
  }

  /**
   * Deletes all rows from the repository.
   */
  public async deleteAll(): Promise<void> {
    return await this.tabularRepository.deleteAll();
  }

  /**
   * Retrieves the number of rows in the repository.
   * @returns The number of rows in the repository
   */
  public async size(): Promise<number> {
    return await this.tabularRepository.size();
  }

  /**
   * Destroys the repository and frees up resources.
   */
  destroy(): void {
    this.tabularRepository.destroy();
  }
}
