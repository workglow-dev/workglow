/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { compileSchema } from "@workglow/util/schema";
import { EditImageTask } from "@workglow/ai";

function validate(schema: unknown, value: unknown) {
  const compiled = compileSchema(schema as any);
  return compiled.validate(value);
}

describe("EditImageTask schemas", () => {
  it("declares static type, category", () => {
    expect(EditImageTask.type).toBe("EditImageTask");
    expect(EditImageTask.category).toBe("AI / Image");
    expect(EditImageTask.cacheable).toBe(true);
  });

  it("input requires prompt, model, image", () => {
    const minimal = validate(EditImageTask.inputSchema(), {
      prompt: "make it sepia",
      model: "openai/gpt-image-2",
      image: "data:image/png;base64,iVBORw0KGgo=",
    });
    expect(minimal.valid).toBe(true);

    const missingImage = validate(EditImageTask.inputSchema(), {
      prompt: "x",
      model: "m",
    });
    expect(missingImage.valid).toBe(false);
  });

  it("mask and additionalImages are optional", () => {
    const result = validate(EditImageTask.inputSchema(), {
      prompt: "x",
      model: "m",
      image: "data:image/png;base64,iVBORw0KGgo=",
      mask: "data:image/png;base64,iVBORw0KGgo=",
      additionalImages: ["data:image/png;base64,iVBORw0KGgo="],
    });
    expect(result.valid).toBe(true);
  });
});
