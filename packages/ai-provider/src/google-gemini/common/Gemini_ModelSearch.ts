/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  ModelSearchResultItem,
  ModelSearchTaskInput,
  ModelSearchTaskOutput,
} from "@workglow/ai";
import { GOOGLE_GEMINI } from "./Gemini_Constants";

const GEMINI_MODELS: Array<{ label: string; value: string }> = [
  { label: "gemini-3.1-flash", value: "gemini-3.1-flash" },
  { label: "gemini-3.1-pro", value: "gemini-3.1-pro" },
  { label: "gemini-2.5-flash", value: "gemini-2.5-flash" },
  { label: "gemini-2.5-pro", value: "gemini-2.5-pro" },
  { label: "gemini-2.0-flash", value: "gemini-2.0-flash" },
  { label: "gemini-1.5-pro", value: "gemini-1.5-pro" },
  { label: "gemini-1.5-flash", value: "gemini-1.5-flash" },
];

export const Gemini_ModelSearch: AiProviderRunFn<
  ModelSearchTaskInput,
  ModelSearchTaskOutput
> = async () => {
  const results: ModelSearchResultItem[] = GEMINI_MODELS.map((m) => ({
    id: m.value,
    label: m.label,
    description: "",
    record: {
      model_id: m.value,
      provider: GOOGLE_GEMINI,
      title: m.value,
      description: "",
      tasks: [],
      provider_config: { model_name: m.value },
      metadata: {},
    },
    raw: m,
  }));
  return { results };
};
