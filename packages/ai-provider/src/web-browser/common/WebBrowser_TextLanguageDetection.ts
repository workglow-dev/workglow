/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  TextLanguageDetectionTaskInput,
  TextLanguageDetectionTaskOutput,
} from "@workglow/ai";
import { getLogger } from "@workglow/util";
import { ensureAvailable, getApi } from "./WebBrowser_ChromeHelpers";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

export const WebBrowser_TextLanguageDetection: AiProviderRunFn<
  TextLanguageDetectionTaskInput,
  TextLanguageDetectionTaskOutput,
  WebBrowserModelConfig
> = async (input, model, update_progress, signal) => {
  const factory = getApi(
    "LanguageDetector",
    typeof LanguageDetector !== "undefined" ? LanguageDetector : undefined
  );
  await ensureAvailable("LanguageDetector", factory);

  if (Array.isArray(input.text)) {
    getLogger().warn(
      "WebBrowser_TextLanguageDetection: array input received; processing sequentially"
    );
    const allResults: Array<Array<{ language: string; score: number }>> = [];
    for (const item of input.text as string[]) {
      const detector = await factory.create();
      try {
        const detected = await detector.detect(item, { signal });
        const mapped = detected
          .map((d) => ({ language: d.detectedLanguage, score: d.confidence }))
          .slice(0, input.maxLanguages ?? 5);
        allResults.push(mapped);
      } finally {
        detector.destroy();
      }
    }
    update_progress(100, "Completed language detection");
    return { languages: allResults } as TextLanguageDetectionTaskOutput;
  }

  const detector = await factory.create();
  try {
    const detected = await detector.detect(input.text as string, { signal });
    const languages = detected
      .map((d) => ({ language: d.detectedLanguage, score: d.confidence }))
      .slice(0, input.maxLanguages ?? 5);
    update_progress(100, "Completed language detection");
    return { languages };
  } finally {
    detector.destroy();
  }
};
