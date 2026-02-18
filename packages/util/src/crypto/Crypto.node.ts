/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// Node.js environment
import { createHash } from "node:crypto";
import { serialize } from "../utilities/Misc";

export async function sha256(data: string) {
  return createHash("sha256").update(data).digest("hex");
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
