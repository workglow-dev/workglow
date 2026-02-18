/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// Browser environment

import { serialize } from "../utilities/Misc";

export async function sha256(data: string) {
  const encoder = new TextEncoder();
  return window.crypto.subtle.digest("SHA-256", encoder.encode(data)).then((hashBuffer) => {
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  });
}

export async function makeFingerprint(input: any): Promise<string> {
  const serializedObj = serialize(input);
  const hash = await sha256(serializedObj);
  return hash;
}

export type uuid4 = `${string}-${string}-${string}-${string}-${string}`;

export function uuid4() {
  return crypto.randomUUID() as uuid4;
}
