/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Sqlite } from "@workglow/sqlite";
import {
  createServiceToken,
  DataPortSchemaObject,
  FromSchema,
  JsonSchema,
  TypedArraySchemaOptions,
} from "@workglow/util";
import { BaseSqlTabularRepository } from "./BaseSqlTabularRepository";
import {
  AnyTabularRepository,
  DeleteSearchCriteria,
  isSearchCondition,
  SearchOperator,
  SimplifyPrimaryKey,
  TabularChangePayload,
  TabularSubscribeOptions,
  ValueOptionType,
} from "./ITabularRepository";

// Define local type for SQL operations
type ExcludeDateKeyOptionType = Exclude<string | number | bigint, Date>;

export const SQLITE_TABULAR_REPOSITORY = createServiceToken<AnyTabularRepository>(
  "storage.tabularRepository.sqlite"
);

const Database = Sqlite.Database;

// SqliteTabularRepository is a key-value store that uses SQLite as the backend for
// in app data.

/**
 * A SQLite-based key-value repository implementation.
 * @template Schema - The schema definition for the entity
 * @template PrimaryKeyNames - Array of property names that form the primary key
 */
export class SqliteTabularRepository<
  Schema extends DataPortSchemaObject,
  PrimaryKeyNames extends ReadonlyArray<keyof Schema["properties"]>,
  // computed types
  Entity = FromSchema<Schema, TypedArraySchemaOptions>,
  PrimaryKey = SimplifyPrimaryKey<Entity, PrimaryKeyNames>,
> extends BaseSqlTabularRepository<Schema, PrimaryKeyNames, Entity, PrimaryKey> {
  /** The SQLite database instance */
  private db: Sqlite.Database;

  /**
   * Creates a new SQLite key-value repository
   * @param dbOrPath - Either a Database instance or a path to the SQLite database file
   * @param table - The name of the table to use for storage (defaults to 'tabular_store')
   * @param schema - Schema defining the structure of the entity
   * @param primaryKeyNames - Array of property names that form the primary key
   * @param indexes - Array of columns or column arrays to make searchable. Each string or single column creates a single-column index,
   *                    while each array creates a compound index with columns in the specified order.
   */
  constructor(
    dbOrPath: string | Sqlite.Database,
    table: string = "tabular_store",
    schema: Schema,
    primaryKeyNames: PrimaryKeyNames,
    indexes: readonly (keyof Entity | readonly (keyof Entity)[])[] = []
  ) {
    super(table, schema, primaryKeyNames, indexes);
    if (typeof dbOrPath === "string") {
      this.db = new Database(dbOrPath);
    } else {
      this.db = dbOrPath;
    }
  }

  /**
   * Creates the database table if it doesn't exist with the defined schema.
   * Must be called before using any other methods.
   */
  public async setupDatabase(): Promise<void> {
    const sql = `
      CREATE TABLE IF NOT EXISTS \`${this.table}\` (
        ${this.constructPrimaryKeyColumns()} ${this.constructValueColumns()},
        PRIMARY KEY (${this.primaryKeyColumnList()}) 
      )
    `;
    this.db.exec(sql);

    // Get primary key columns to avoid creating redundant indexes
    const pkColumns = this.primaryKeyColumns();

    // Track created indexes to avoid duplicates and redundant indexes
    const createdIndexes = new Set<string>();

    for (const searchSpec of this.indexes) {
      // Handle both single column and compound indexes
      const columns = Array.isArray(searchSpec) ? searchSpec : [searchSpec];

      // Skip if this is just the primary key or a prefix of it
      if (columns.length <= pkColumns.length) {
        // @ts-ignore
        const isPkPrefix = columns.every((col, idx) => col === pkColumns[idx]);
        if (isPkPrefix) continue;
      }

      // Create index name and column list
      const indexName = `${this.table}_${columns.join("_")}`;
      const columnList = columns.map((col) => `\`${String(col)}\``).join(", ");

      // Skip if we've already created this index or if it's redundant
      const columnKey = columns.join(",");
      if (createdIndexes.has(columnKey)) continue;

      // Check if this index would be redundant with an existing one
      const isRedundant = Array.from(createdIndexes).some((existing) => {
        const existingCols = existing.split(",");
        return (
          existingCols.length >= columns.length &&
          columns.every((col, idx) => col === existingCols[idx])
        );
      });

      if (!isRedundant) {
        this.db.exec(
          `CREATE INDEX IF NOT EXISTS \`${indexName}\` ON \`${this.table}\` (${columnList})`
        );
        createdIndexes.add(columnKey);
      }
    }
  }

  /**
   * Convert JS values to SQLite-compatible values. Ensures booleans are stored as 0/1.
   */
  protected jsToSqlValue(column: string, value: Entity[keyof Entity]): ValueOptionType {
    if (value !== null && value !== undefined && typeof value === "object") {
      // Handle special types that should be passed to base class
      if (value instanceof Date) {
        return super.jsToSqlValue(column, value);
      }
      if (value instanceof Uint8Array) {
        return super.jsToSqlValue(column, value);
      }
      if (typeof Buffer !== "undefined" && value instanceof Buffer) {
        return super.jsToSqlValue(column, value);
      }
      // Convert ALL other objects and arrays to JSON string
      return JSON.stringify(value) as ValueOptionType;
    }

    // Handle null values
    if (value === null) {
      const typeDef = this.schema.properties[column as keyof typeof this.schema.properties] as
        | JsonSchema
        | undefined;
      if (typeDef && this.isNullable(typeDef)) {
        return null;
      }
      // If not nullable, fall through to base class
    }

    // Schema-based type handling for non-object/array values
    const typeDef = this.schema.properties[column as keyof typeof this.schema.properties] as
      | JsonSchema
      | undefined;
    if (typeDef) {
      const actualType = this.getNonNullType(typeDef);
      const isObject =
        typeDef === true || (typeof actualType !== "boolean" && actualType.type === "object");
      const isArray =
        typeDef === true || (typeof actualType !== "boolean" && actualType.type === "array");
      const isBoolean =
        typeDef === true || (typeof actualType !== "boolean" && actualType.type === "boolean");
      if (isBoolean) {
        const v: any = value as any;
        if (typeof v === "boolean") return v ? 1 : 0;
        if (typeof v === "number") return v ? 1 : 0;
        if (typeof v === "string") return v === "1" || v.toLowerCase() === "true" ? 1 : 0;
      }
      // Note: Objects/arrays are already handled above by runtime check
      // This check is here for cases where schema says object but runtime value isn't
      if ((isObject || isArray) && value !== null && typeof value === "object") {
        // Double-check: if schema says object/array but wasn't caught by runtime check above
        if (
          !(value instanceof Date) &&
          !(value instanceof Uint8Array) &&
          (typeof Buffer === "undefined" || !(value instanceof Buffer))
        ) {
          if (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype) {
            return JSON.stringify(value) as ValueOptionType;
          }
        }
      }
    }

    const result = super.jsToSqlValue(column, value);

    // Final safety check: ensure we never return an object or array
    // The base class should not return objects, but if it does, convert them
    if (result !== null && typeof result === "object") {
      // TypeScript now knows result is an object (not null), so we can use instanceof
      const resultObj = result as object;
      if (
        !(resultObj instanceof Uint8Array) &&
        (typeof Buffer === "undefined" || !(resultObj instanceof Buffer))
      ) {
        // Convert any remaining objects/arrays to JSON string
        return JSON.stringify(resultObj) as ValueOptionType;
      }
    }

    return result;
  }

  /**
   * Convert SQLite values to JS values. Ensures 0/1 become booleans where schema says boolean.
   */
  protected sqlToJsValue(column: string, value: ValueOptionType): Entity[keyof Entity] {
    const typeDef = this.schema.properties[column as keyof typeof this.schema.properties] as
      | JsonSchema
      | undefined;
    if (typeDef) {
      if (value === null && this.isNullable(typeDef)) {
        return null as any;
      }
      const actualType = this.getNonNullType(typeDef);
      const isObject =
        typeDef === true || (typeof actualType !== "boolean" && actualType.type === "object");
      const isArray =
        typeDef === true || (typeof actualType !== "boolean" && actualType.type === "array");
      const isBoolean =
        typeDef === true || (typeof actualType !== "boolean" && actualType.type === "boolean");

      if (isBoolean) {
        const v: any = value as any;
        if (typeof v === "boolean") return v as any;
        if (typeof v === "number") return (v !== 0 ? true : false) as Entity[keyof Entity];
        if (typeof v === "string")
          return (v === "1" || v.toLowerCase() === "true" ? true : false) as Entity[keyof Entity];
      }

      // Handle array and object types - parse JSON string back to object/array
      if (isArray || isObject) {
        if (typeof value === "string") {
          try {
            return JSON.parse(value) as Entity[keyof Entity];
          } catch (e) {
            // If parsing fails, return the value as-is (might be a string that looks like JSON)
            return value as Entity[keyof Entity];
          }
        }
        // If it's already an object/array (shouldn't happen, but handle gracefully)
        return value as Entity[keyof Entity];
      }
    }
    return super.sqlToJsValue(column, value);
  }

  /**
   * Maps TypeScript/JavaScript types to their SQLite column type equivalents
   * Uses additional schema information like minimum/maximum values, nullable status,
   * and string lengths to create more optimized column types.
   *
   * @param typeDef - The TypeScript/JavaScript type definition
   * @returns The corresponding SQLite column type
   */
  protected mapTypeToSQL(typeDef: JsonSchema): string {
    // Get the actual non-null type for proper mapping
    const actualType = this.getNonNullType(typeDef);
    if (typeof actualType === "boolean") {
      return "TEXT /* boolean schema */";
    }

    // Handle BLOB type
    if (actualType.contentEncoding === "blob") return "BLOB";

    switch (actualType.type) {
      case "string":
        // Handle special string formats
        if (actualType.format === "date-time") return "TEXT"; // SQLite doesn't have a native TIMESTAMP
        if (actualType.format === "date") return "TEXT";

        // For strings with max length constraints, we can still note this in the schema
        // even though SQLite doesn't enforce VARCHAR lengths
        if (typeof actualType.maxLength === "number") {
          return `TEXT /* VARCHAR(${actualType.maxLength}) */`;
        }

        return "TEXT";

      case "number":
      case "integer":
        // SQLite has limited numeric types, but we can use INTEGER for integers
        // and REAL for floating point numbers

        // The multipleOf property in JSON Schema specifies that a number must be a
        // multiple of a given value. When set to 1, it means the number must be a
        // whole number multiple of 1, which effectively means it must be an integer.
        if (actualType.multipleOf === 1 || actualType.type === "integer") {
          return "INTEGER";
        }

        return "REAL";

      case "boolean":
        // SQLite uses INTEGER 0/1 for boolean
        return "INTEGER";

      case "array":
      case "object":
        return "TEXT /* JSON */";

      default:
        return "TEXT /* unknown type */";
    }
  }

  /**
   * Stores a key-value pair in the database
   * @param entity - The entity to store
   * @returns The entity with any server-generated fields updated
   * @emits 'put' event when successful
   */
  async put(entity: Entity): Promise<Entity> {
    const db = this.db;
    const { key, value } = this.separateKeyValueFromCombined(entity);
    const sql = `
      INSERT OR REPLACE INTO \`${
        this.table
      }\` (${this.primaryKeyColumnList()} ${this.valueColumnList() ? ", " + this.valueColumnList() : ""})
      VALUES (
        ${this.primaryKeyColumns().map((i) => "?")}
        ${this.valueColumns().length > 0 ? ", " + this.valueColumns().map((i) => "?") : ""}
      )
      RETURNING *
    `;
    const stmt = db.prepare(sql);

    const primaryKeyParams = this.getPrimaryKeyAsOrderedArray(key);
    const valueParams = this.getValueAsOrderedArray(value);
    const params = [...primaryKeyParams, ...valueParams];

    // CRITICAL: Ensure all params are SQLite-compatible before binding
    // SQLite only accepts: string, number, bigint, boolean, null, Uint8Array
    for (let i = 0; i < params.length; i++) {
      let param = params[i];

      // Convert undefined to null
      if (param === undefined) {
        params[i] = null;
        continue;
      }

      // Convert objects/arrays to JSON string (except Uint8Array and Buffer)
      if (param !== null && typeof param === "object") {
        const paramObj = param as object;
        if (paramObj instanceof Uint8Array) {
          // Uint8Array is valid, keep as-is
          continue;
        }
        if (typeof Buffer !== "undefined" && paramObj instanceof Buffer) {
          // Buffer should be handled by jsToSqlValue, but convert to Uint8Array just in case
          params[i] = new Uint8Array(paramObj) as ValueOptionType;
          continue;
        }
        // Convert ALL other objects/arrays to JSON string
        try {
          params[i] = JSON.stringify(paramObj) as ValueOptionType;
        } catch (e) {
          throw new Error(
            `Failed to stringify param at index ${i} for column binding: ${String(e)}`
          );
        }
        continue;
      }
    }

    // Final validation - ensure no objects/arrays remain and log for debugging
    const invalidParams: Array<{ index: number; type: string; value: any }> = [];
    for (let i = 0; i < params.length; i++) {
      const param = params[i];
      // Check if it's a valid SQLite type
      if (
        param === null ||
        param === undefined ||
        typeof param === "string" ||
        typeof param === "number" ||
        typeof param === "boolean" ||
        typeof param === "bigint"
      ) {
        // Valid primitive types
        continue;
      }

      // For objects, check if it's Uint8Array or Buffer
      if (typeof param === "object") {
        const paramObj = param as object;
        if (
          paramObj instanceof Uint8Array ||
          (typeof Buffer !== "undefined" && paramObj instanceof Buffer)
        ) {
          // Valid object types
          continue;
        }
        // Invalid object type
        invalidParams.push({ index: i, type: typeof param, value: param });
      } else {
        // Invalid type
        invalidParams.push({ index: i, type: typeof param, value: param });
      }
    }

    if (invalidParams.length > 0) {
      console.error("Invalid params detected:", invalidParams);
      console.error(
        "All params:",
        params.map((p, i) => ({ i, type: typeof p, value: p, isArray: Array.isArray(p) }))
      );
      throw new Error(
        `Invalid SQLite params detected at indices: ${invalidParams.map((p) => p.index).join(", ")}`
      );
    }

    // @ts-ignore
    const updatedEntity = stmt.get(...params) as Entity;

    // Convert all columns according to schema
    for (const k in this.schema.properties) {
      // @ts-ignore
      updatedEntity[k] = this.sqlToJsValue(k, updatedEntity[k]);
    }

    this.events.emit("put", updatedEntity);
    return updatedEntity;
  }

  /**
   * Stores multiple key-value pairs in the database in a bulk operation
   * @param entities - Array of entities to store
   * @returns Array of entities with any server-generated fields updated
   * @emits 'put' event for each entity stored
   */
  async putBulk(entities: Entity[]): Promise<Entity[]> {
    if (entities.length === 0) return [];

    const db = this.db;

    // For SQLite bulk inserts with RETURNING, we need to do them individually
    // or use a transaction with multiple INSERT statements
    const updatedEntities: Entity[] = [];

    // Use a transaction for better performance
    const transaction = db.transaction((entitiesToInsert: Entity[]) => {
      for (const entity of entitiesToInsert) {
        const { key, value } = this.separateKeyValueFromCombined(entity);
        const sql = `
          INSERT OR REPLACE INTO \`${
            this.table
          }\` (${this.primaryKeyColumnList()} ${this.valueColumnList() ? ", " + this.valueColumnList() : ""})
          VALUES (
            ${this.primaryKeyColumns()
              .map(() => "?")
              .join(", ")}
            ${
              this.valueColumns().length > 0
                ? ", " +
                  this.valueColumns()
                    .map(() => "?")
                    .join(", ")
                : ""
            }
          )
          RETURNING *
        `;
        const stmt = db.prepare(sql);
        const primaryKeyParams = this.getPrimaryKeyAsOrderedArray(key);
        const valueParams = this.getValueAsOrderedArray(value);
        const params = [...primaryKeyParams, ...valueParams];

        // Ensure all params are SQLite-compatible (same validation as put method)
        for (let i = 0; i < params.length; i++) {
          let param = params[i];
          if (param === undefined) {
            params[i] = null;
          } else if (param !== null && typeof param === "object") {
            // TypeScript now knows param is an object (not null), so we can use instanceof
            const paramObj: object = param as object;
            if (
              !(paramObj instanceof Uint8Array) &&
              (typeof Buffer === "undefined" || !(paramObj instanceof Buffer))
            ) {
              params[i] = JSON.stringify(paramObj) as ValueOptionType;
            }
          }
        }

        // @ts-ignore
        const updatedEntity = stmt.get(...params) as Entity;

        // Convert all columns according to schema
        for (const k in this.schema.properties) {
          // @ts-ignore
          updatedEntity[k] = this.sqlToJsValue(k, updatedEntity[k]);
        }

        updatedEntities.push(updatedEntity);
      }
    });

    transaction(entities);

    for (const entity of updatedEntities) {
      this.events.emit("put", entity);
    }

    return updatedEntities;
  }

  /**
   * Retrieves a value from the database by its key
   * @param key - The primary key object to look up
   * @returns The stored value or undefined if not found
   * @emits 'get' event when successful
   */
  async get(key: PrimaryKey): Promise<Entity | undefined> {
    const db = this.db;
    const whereClauses = (this.primaryKeyColumns() as string[])
      .map((key) => `\`${key}\` = ?`)
      .join(" AND ");

    const sql = `
      SELECT * FROM \`${this.table}\` WHERE ${whereClauses}
    `;
    const stmt = db.prepare(sql);
    const params = this.getPrimaryKeyAsOrderedArray(key);
    // @ts-ignore - SQLite typing for variadic bindings is overly strict for our union
    const value: Entity | null = stmt.get(...(params as any));
    if (value) {
      for (const k in this.schema.properties) {
        // @ts-ignore
        value[k] = this.sqlToJsValue(k, (value as any)[k]);
      }
      this.events.emit("get", key, value);
      return value;
    } else {
      this.events.emit("get", key, undefined);
      return undefined;
    }
  }

  /**
   * Method to be implemented by concrete repositories to search for key-value pairs
   * based on a partial key.
   *
   * @param key - Partial key to search for
   * @returns Promise resolving to an array of combined key-value objects or undefined if not found
   */
  public async search(key: Partial<Entity>): Promise<Entity[] | undefined> {
    const db = this.db;
    const searchKeys = Object.keys(key) as Array<keyof Entity>;
    if (searchKeys.length === 0) {
      return undefined;
    }

    // Find the best matching index for the search
    const bestIndex = super.findBestMatchingIndex(searchKeys);
    if (!bestIndex) {
      throw new Error(
        `No suitable index found for the search criteria, searching for ['${searchKeys.join(
          "', '"
        )}'] with pk ['${this.primaryKeyNames.join("', '")}'] and indexes ['${this.indexes.join(
          "', '"
        )}']`
      );
    }

    // very columns in primary key or value schema
    const validColumns = [...this.primaryKeyColumns(), ...this.valueColumns()];
    // @ts-ignore
    const invalidColumns = searchKeys.filter((key) => !validColumns.includes(key));
    if (invalidColumns.length > 0) {
      throw new Error(`Invalid columns in search criteria: ${invalidColumns.join(", ")}`);
    }

    const whereClauses = Object.keys(key)
      .map((key, i) => `"${key}" = ?`)
      .join(" AND ");
    const whereClauseValues = Object.entries(key).map(([k, v]) =>
      // @ts-ignore
      this.jsToSqlValue(k, v as any)
    );

    const sql = `SELECT * FROM \`${this.table}\` WHERE ${whereClauses}`;
    const stmt = db.prepare<Entity, ExcludeDateKeyOptionType[]>(sql);
    // @ts-ignore
    const result = stmt.all(...whereClauseValues);

    if (result.length > 0) {
      // Convert all returned rows according to schema (not only value columns)
      for (const row of result as any[]) {
        for (const k in this.schema.properties) {
          row[k] = this.sqlToJsValue(k, row[k]);
        }
      }
      this.events.emit("search", key, result);
      return result;
    } else {
      this.events.emit("search", key, undefined);
      return undefined;
    }
  }

  /**
   * Deletes a key-value pair from the database
   * @param key - The primary key object to delete
   * @emits 'delete' event when successful
   */
  async delete(key: PrimaryKey): Promise<void> {
    const db = this.db;
    const whereClauses = (this.primaryKeyColumns() as string[])
      .map((key) => `${key} = ?`)
      .join(" AND ");
    const params = this.getPrimaryKeyAsOrderedArray(key);
    const stmt = db.prepare(`DELETE FROM \`${this.table}\` WHERE ${whereClauses}`);
    // @ts-ignore - SQLite typing for variadic bindings is overly strict for our union
    stmt.run(...(params as any));
    this.events.emit("delete", key as keyof Entity);
  }

  /**
   * Retrieves all entries from the database table
   * @returns Promise resolving to an array of entries or undefined if not found
   */
  async getAll(): Promise<Entity[] | undefined> {
    const db = this.db;
    const sql = `SELECT * FROM \`${this.table}\``;
    const stmt = db.prepare<Entity, []>(sql);
    const value = stmt.all();
    if (!value.length) return undefined;
    // Convert all columns according to schema for each row
    for (const row of value as any[]) {
      for (const k in this.schema.properties) {
        row[k] = this.sqlToJsValue(k, row[k]);
      }
    }
    return value;
  }

  /**
   * Deletes all entries from the database table
   * @emits 'clearall' event when successful
   */
  async deleteAll(): Promise<void> {
    const db = this.db;
    db.exec(`DELETE FROM \`${this.table}\``);
    this.events.emit("clearall");
  }

  /**
   * Gets the total number of entries in the database table
   * @returns The count of entries
   */
  async size(): Promise<number> {
    const db = this.db;
    const stmt = db.prepare<{ count: number }, []>(`
      SELECT COUNT(*) AS count FROM \`${this.table}\`
    `);
    return stmt.get()?.count || 0;
  }

  /**
   * Builds WHERE clause conditions from delete search criteria.
   * @param criteria - The search criteria object
   * @returns Object with whereClause string and params array
   */
  protected buildDeleteSearchWhere(criteria: DeleteSearchCriteria<Entity>): {
    whereClause: string;
    params: ValueOptionType[];
  } {
    const conditions: string[] = [];
    const params: ValueOptionType[] = [];

    for (const column of Object.keys(criteria) as Array<keyof Entity>) {
      if (!(column in this.schema.properties)) {
        throw new Error(`Schema must have a ${String(column)} field to use deleteSearch`);
      }

      const criterion = criteria[column];
      let operator: SearchOperator = "=";
      let value: Entity[keyof Entity];

      if (isSearchCondition(criterion)) {
        operator = criterion.operator;
        value = criterion.value as Entity[keyof Entity];
      } else {
        value = criterion as Entity[keyof Entity];
      }

      conditions.push(`\`${String(column)}\` ${operator} ?`);
      params.push(this.jsToSqlValue(column as string, value));
    }

    return {
      whereClause: conditions.join(" AND "),
      params,
    };
  }

  /**
   * Deletes all entries matching the specified search criteria.
   * Supports multiple columns with optional comparison operators.
   *
   * @param criteria - Object with column names as keys and values or SearchConditions
   */
  async deleteSearch(criteria: DeleteSearchCriteria<Entity>): Promise<void> {
    const criteriaKeys = Object.keys(criteria) as Array<keyof Entity>;
    if (criteriaKeys.length === 0) {
      return;
    }

    const db = this.db;
    const { whereClause, params } = this.buildDeleteSearchWhere(criteria);
    const stmt = db.prepare(`DELETE FROM \`${this.table}\` WHERE ${whereClause}`);
    // @ts-ignore
    stmt.run(...params);
    this.events.emit("delete", criteriaKeys[0] as keyof Entity);
  }

  /**
   * Subscribes to changes in the repository.
   * NOT IMPLEMENTED for SQLite storage.
   *
   * @throws Error always - subscribeToChanges is not supported for SQLite storage
   */
  subscribeToChanges(
    callback: (change: TabularChangePayload<Entity>) => void,
    options?: TabularSubscribeOptions
  ): () => void {
    throw new Error("subscribeToChanges is not supported for SqliteTabularRepository");
  }

  /**
   * Destroys the repository and frees up resources.
   */
  destroy(): void {
    super.destroy();
  }
}
