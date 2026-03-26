/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelSearchTaskInput, ModelSearchTaskOutput } from "@workglow/ai";
import { searchHfModels, mapHfModelResult } from "../../common/HfModelSearch";
import { HF_INFERENCE } from "./HFI_Constants";

export const HFI_ModelSearch: AiProviderRunFn<ModelSearchTaskInput, ModelSearchTaskOutput> = async (
  input,
  _model,
  _onProgress,
  signal
) => {
  const entries = await searchHfModels(input.query?.trim() ?? "", undefined, undefined, signal);
  const results = entries.map((entry) => mapHfModelResult(entry, HF_INFERENCE));
  return { results };
};
