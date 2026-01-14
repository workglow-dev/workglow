/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryTabularStorage } from "@workglow/storage";
import { ModelRepository } from "./ModelRepository";
import { ModelPrimaryKeyNames, ModelRecordSchema } from "./ModelSchema";

/**
 * In-memory implementation of a model repository.
 * Provides storage and retrieval for models and task-to-model mappings.
 */
export class InMemoryModelRepository extends ModelRepository {
  constructor() {
    super(new InMemoryTabularStorage(ModelRecordSchema, ModelPrimaryKeyNames));
  }
}
