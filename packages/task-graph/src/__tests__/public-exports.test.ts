/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  TransformRegistry,
  TRANSFORM_DEFS,
  registerBuiltInTransforms,
  autoConnect,
  pickTransform,
  indexTransform,
} from "@workglow/task-graph";

describe("public exports for transforms + autoConnect", () => {
  it("exposes transform registry and helpers", () => {
    expect(TransformRegistry).toBeDefined();
    expect(TRANSFORM_DEFS).toBeDefined();
    expect(registerBuiltInTransforms).toBeDefined();
    expect(autoConnect).toBeDefined();
    expect(pickTransform.id).toBe("pick");
    expect(indexTransform.id).toBe("index");
  });
});
