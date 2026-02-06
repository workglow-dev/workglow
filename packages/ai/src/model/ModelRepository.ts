/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { type BaseTabularStorage } from "@workglow/storage";
import { EventEmitter, EventParameters } from "@workglow/util";

import { ModelPrimaryKeyNames, ModelRecord, ModelRecordSchema } from "./ModelSchema";

/**
 * Events that can be emitted by the ModelRepository
 */

export type ModelEventListeners = {
  model_added: (model: ModelRecord) => void;
  model_removed: (model: ModelRecord) => void;
  model_updated: (model: ModelRecord) => void;
};

export type ModelEvents = keyof ModelEventListeners;

export type ModelEventListener<Event extends ModelEvents> = ModelEventListeners[Event];

export type ModelEventParameters<Event extends ModelEvents> = EventParameters<
  ModelEventListeners,
  Event
>;

/**
 * Base class for managing AI models and their relationships with tasks.
 * Provides functionality for storing, retrieving, and managing the lifecycle of models
 * and their associations with specific tasks.
 */
export class ModelRepository {
  /**
   * Repository for storing and managing Model instances
   */
  protected readonly modelTabularRepository: BaseTabularStorage<
    typeof ModelRecordSchema,
    typeof ModelPrimaryKeyNames
  >;
  constructor(
    modelTabularRepository: BaseTabularStorage<
      typeof ModelRecordSchema,
      typeof ModelPrimaryKeyNames
    >
  ) {
    this.modelTabularRepository = modelTabularRepository;
  }

  /** Event emitter for repository events */
  protected events = new EventEmitter<ModelEventListeners>();

  /**
   * Sets up the database for the repository.
   * Must be called before using any other methods.
   */
  async setupDatabase(): Promise<void> {
    await this.modelTabularRepository.setupDatabase?.();
  }

  /**
   * Registers an event listener for the specified event
   * @param name - The event name to listen for
   * @param fn - The callback function to execute when the event occurs
   */
  on<Event extends ModelEvents>(name: Event, fn: ModelEventListener<Event>) {
    this.events.on(name, fn);
  }

  /**
   * Removes an event listener for the specified event
   * @param name - The event name to stop listening for
   * @param fn - The callback function to remove
   */
  off<Event extends ModelEvents>(name: Event, fn: ModelEventListener<Event>) {
    this.events.off(name, fn);
  }

  /**
   * Adds an event listener that will only be called once
   * @param name - The event name to listen for
   * @param fn - The callback function to execute when the event occurs
   */
  once<Event extends ModelEvents>(name: Event, fn: ModelEventListener<Event>) {
    this.events.once(name, fn);
  }

  /**
   * Returns when the event was emitted (promise form of once)
   * @param name - The event name to check
   * @returns a promise that resolves to the event listener parameters
   */
  waitOn<Event extends ModelEvents>(name: Event) {
    return this.events.waitOn(name);
  }

  /**
   * Adds a new model to the repository
   * @param model - The model instance to add
   */
  async addModel(model: ModelRecord) {
    await this.modelTabularRepository.put(model);
    this.events.emit("model_added", model);
    return model;
  }

  /**
   * Removes a model from the repository
   * @param model_id - The model_id of the model to remove
   */
  async removeModel(model_id: string): Promise<void> {
    const model = await this.modelTabularRepository.get({ model_id });
    if (!model) {
      throw new Error(`Model with id "${model_id}" not found`);
    }
    await this.modelTabularRepository.delete({ model_id });
    this.events.emit("model_removed", model);
  }

  /**
   * Finds all models associated with a specific task
   * @param task - The task identifier to search for
   * @returns Promise resolving to an array of associated models, or undefined if none found
   */
  async findModelsByTask(task: string) {
    if (typeof task != "string") return undefined;
    const allModels = await this.modelTabularRepository.getAll();
    if (!allModels || allModels.length === 0) return undefined;
    const models = allModels.filter((model) => model.tasks?.includes(task));
    if (models.length === 0) return undefined;
    return models;
  }

  /**
   * Finds all tasks associated with a specific model
   * @param model - The model identifier to search for
   * @returns Promise resolving to an array of associated tasks, or undefined if none found
   */
  async findTasksByModel(model_id: string) {
    if (typeof model_id != "string") return undefined;
    const modelRecord = await this.modelTabularRepository.get({ model_id });
    if (!modelRecord) return undefined;
    return modelRecord.tasks && modelRecord.tasks.length > 0 ? modelRecord.tasks : undefined;
  }

  /**
   * Enumerates all tasks in the repository
   * @returns Promise resolving to an array of task identifiers
   */
  async enumerateAllTasks() {
    const allModels = await this.modelTabularRepository.getAll();
    if (!allModels || allModels.length === 0) return undefined;
    const uniqueTasks = new Set<string>();
    for (const model of allModels) {
      if (model.tasks) {
        for (const task of model.tasks) {
          uniqueTasks.add(task);
        }
      }
    }
    return uniqueTasks.size > 0 ? Array.from(uniqueTasks) : undefined;
  }

  /**
   * Enumerates all models in the repository
   * @returns Promise resolving to an array of model instances
   */
  async enumerateAllModels(): Promise<ModelRecord[] | undefined> {
    const models = await this.modelTabularRepository.getAll();
    if (!models || models.length === 0) return undefined;
    return models;
  }

  /**
   * Retrieves a model by its identifier
   * @param modelId - The model_id of the model to find
   * @returns Promise resolving to the found model or undefined if not found
   */
  async findByName(model_id: string): Promise<ModelRecord | undefined> {
    if (typeof model_id != "string") return undefined;
    const model = await this.modelTabularRepository.get({ model_id });
    return model ?? undefined;
  }

  /**
   * Gets the total number of models in the repository
   * @returns Promise resolving to the number of stored models
   */
  async size(): Promise<number> {
    return await this.modelTabularRepository.size();
  }
}
