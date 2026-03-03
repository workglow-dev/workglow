/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITaskConstructor } from "@workglow/task-graph";
import { TaskRegistry } from "@workglow/task-graph";
import {
  createServiceToken,
  globalServiceRegistry,
  registerInputResolver,
  ServiceRegistry,
} from "@workglow/util";
import type { ToolDefinition } from "./ToolCallingTask";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTaskConstructor = ITaskConstructor<any, any, any>;

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
 * Registers a single task constructor into the global task constructors map.
 * @param type The task type name
 * @param ctor The task constructor
 */
export function registerTaskConstructor(type: string, ctor: AnyTaskConstructor): void {
  getGlobalTaskConstructors().set(type, ctor);
}

/**
 * Clears all entries from the global task constructors map.
 */
export function clearTaskConstructors(): void {
  getGlobalTaskConstructors().clear();
}

/**
 * Gets the task constructors map from the given registry,
 * falling back to the global TaskRegistry.
 */
function getTaskConstructors(registry: ServiceRegistry): Map<string, AnyTaskConstructor> {
  return registry.has(TASK_CONSTRUCTORS) ? registry.get(TASK_CONSTRUCTORS) : TaskRegistry.all;
}

/**
 * Resolves a task type name to a {@link ToolDefinition} via the task constructor registry.
 *
 * Used by the input resolver system for `format: "skills"` properties.
 * Converts lightweight string IDs (stored by the property editor) into full
 * tool definition objects at runtime.
 *
 * @param id - Task type name registered in TaskRegistry
 * @param format - The format string (unused)
 * @param registry - Service registry for context-specific lookups
 * @returns ToolDefinition object, or undefined if the task type is not found
 */
function resolveSkillFromRegistry(
  id: string,
  _format: string,
  registry: ServiceRegistry
): ToolDefinition | undefined {
  const constructors = getTaskConstructors(registry);
  const ctor = constructors.get(id);
  if (!ctor) return undefined;
  return {
    name: ctor.type,
    description: ctor.description ?? "",
    inputSchema: ctor.inputSchema(),
    outputSchema: ctor.outputSchema(),
  };
}

// Register the skills resolver for format: "skills"
registerInputResolver("skills", resolveSkillFromRegistry);
