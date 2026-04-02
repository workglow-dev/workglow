/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseError } from "@workglow/util";

export class StorageError extends BaseError {
  static override readonly type: string = "StorageError";
}

export class StorageValidationError extends StorageError {
  static override readonly type: string = "StorageValidationError";
}

export class StorageEmptyCriteriaError extends StorageValidationError {
  static override readonly type: string = "StorageEmptyCriteriaError";
  constructor() {
    super("Query criteria must not be empty. Use getAll() to retrieve all records.");
  }
}

export class StorageInvalidLimitError extends StorageValidationError {
  static override readonly type: string = "StorageInvalidLimitError";
  constructor(limit: number) {
    super(`Query limit must be greater than 0, got ${limit}`);
  }
}

export class StorageInvalidColumnError extends StorageValidationError {
  static override readonly type: string = "StorageInvalidColumnError";
  constructor(column: string) {
    super(`Column "${column}" does not exist in the schema`);
  }
}

export class StorageUnsupportedError extends StorageError {
  static override readonly type: string = "StorageUnsupportedError";
  constructor(operation: string, backend: string) {
    super(`${operation} is not supported for ${backend}`);
  }
}
