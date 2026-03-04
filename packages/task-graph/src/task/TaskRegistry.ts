/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createServiceToken,
  globalServiceRegistry,
  registerInputResolver,
  ServiceRegistry,
} from "@workglow/util";
import type { ITaskConstructor } from "./ITask";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTaskConstructor = ITaskConstructor<any, any, any>;

/**
 * Map storing all registered task constructors.
 * Keys are task type identifiers and values are their corresponding constructor functions.
 */
const taskConstructors = new Map<string, AnyTaskConstructor>();

/**
 * Registers a task constructor with the registry.
 * This allows the task type to be instantiated dynamically based on its type identifier.
 *
 * @param type - The unique identifier for the task type
 * @param constructor - The constructor function for the task
 * @throws Error if a task with the same type is already registered
 */
function registerTask(baseClass: AnyTaskConstructor): void {
  if (taskConstructors.has(baseClass.type)) {
    // TODO: fix this
    // throw new Error(`Task type ${baseClass.type} is already registered`);
  }
  taskConstructors.set(baseClass.type, baseClass);
}

/**
 * TaskRegistry provides a centralized registry for task types.
 * It enables dynamic task instantiation and management across the application.
 */
export const TaskRegistry = {
  /**
   * Map containing all registered task constructors
   */
  all: taskConstructors,

  /**
   * Function to register new task types
   */
  registerTask,
};

// ========================================================================
// DI-based access
// ========================================================================

/**
 * Service token for the task constructor registry.
 * Maps task type names to their constructor functions.
 */
export const TASK_CONSTRUCTORS =
  createServiceToken<Map<string, AnyTaskConstructor>>("task.constructors");

// Register default factory backed by the global TaskRegistry
if (!globalServiceRegistry.has(TASK_CONSTRUCTORS)) {
  globalServiceRegistry.register(
    TASK_CONSTRUCTORS,
    (): Map<string, AnyTaskConstructor> => TaskRegistry.all,
    true
  );
}

/**
 * Gets the global task constructors map.
 * @returns The registered task constructors map
 */
export function getGlobalTaskConstructors(): Map<string, AnyTaskConstructor> {
  return globalServiceRegistry.get(TASK_CONSTRUCTORS);
}

/**
 * Sets the global task constructors map, replacing the default TaskRegistry-backed factory.
 * @param map The task constructors map to register
 */
export function setGlobalTaskConstructors(map: Map<string, AnyTaskConstructor>): void {
  globalServiceRegistry.registerInstance(TASK_CONSTRUCTORS, map);
}

/**
 * Gets the task constructors map from the given registry,
 * falling back to the global TaskRegistry.
 */
export function getTaskConstructors(registry?: ServiceRegistry): Map<string, AnyTaskConstructor> {
  if (!registry) return TaskRegistry.all;
  return registry.has(TASK_CONSTRUCTORS) ? registry.get(TASK_CONSTRUCTORS) : TaskRegistry.all;
}

// ========================================================================
// Tasks resolver
// ========================================================================

/**
 * Resolves a task type name to a tool definition object via the task constructor registry.
 *
 * Used by the input resolver system for `format: "tasks"` properties.
 * Converts lightweight string IDs (stored by the property editor) into full
 * tool definition objects at runtime.
 *
 * @param id - Task type name registered in TaskRegistry
 * @param format - The format string (unused)
 * @param registry - Service registry for context-specific lookups
 * @returns Tool definition object, or undefined if the task type is not found
 */
function resolveTaskFromRegistry(
  id: string,
  _format: string,
  registry: ServiceRegistry
): { name: string; description: string; inputSchema: unknown; outputSchema: unknown } | undefined {
  const constructors = getTaskConstructors(registry);
  const ctor = constructors.get(id);
  if (!ctor) return undefined;
  return {
    name: ctor.type,
    description: (ctor as { description?: string }).description ?? "",
    inputSchema: ctor.inputSchema(),
    outputSchema: ctor.outputSchema(),
  };
}

// Register the tasks resolver for format: "tasks"
registerInputResolver("tasks", resolveTaskFromRegistry);
