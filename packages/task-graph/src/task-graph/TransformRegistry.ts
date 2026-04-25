/**
 * @license Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken, globalServiceRegistry } from "@workglow/util";
import type { ITransformDef } from "./TransformTypes";

const transformDefs = new Map<string, ITransformDef<any>>();

/** Register / unregister / inspect global transforms. */
export const TransformRegistry = {
  all: transformDefs,
  registerTransform(def: ITransformDef<any>): void {
    transformDefs.set(def.id, def);
  },
  unregisterTransform(id: string): void {
    transformDefs.delete(id);
  },
};

/** DI token — mirrors TASK_CONSTRUCTORS pattern. */
export const TRANSFORM_DEFS = createServiceToken<Map<string, ITransformDef<any>>>(
  "transform.defs",
);

globalServiceRegistry.registerIfAbsent(
  TRANSFORM_DEFS,
  (): Map<string, ITransformDef<any>> => TransformRegistry.all,
  true,
);
