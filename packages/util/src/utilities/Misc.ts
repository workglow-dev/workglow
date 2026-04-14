/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export function forceArray<T = unknown>(input: T | T[]): T[] {
  if (Array.isArray(input)) return input;
  return [input];
}

export async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Takes an array of objects and collects values for each property into arrays
 * @param input Array of objects to process
 * @returns Object with arrays of values for each property
 */
export function collectPropertyValues<Input>(input: Input[]): { [K in keyof Input]: Input[K][] } {
  const output = {} as { [K in keyof Input]: Input[K][] };

  (input || []).forEach((item) => {
    Object.keys(item as object).forEach((key) => {
      const value = item[key as keyof Input];
      if (output[key as keyof Input]) {
        output[key as keyof Input].push(value);
      } else {
        output[key as keyof Input] = [value];
      }
    });
  });

  return output;
}

export function toSQLiteTimestamp(date: Date | null | undefined) {
  if (!date) return null;
  const pad = (number: number) => (number < 10 ? "0" + number : number);

  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1); // getUTCMonth() returns months from 0-11
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function deepEqual(a: any, b: any): boolean {
  if (a === b) {
    return true;
  }

  if (typeof a !== "object" || typeof b !== "object" || a == null || b == null) {
    return false;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) {
    return false;
  }

  for (const key of keysA) {
    if (!keysB.includes(key)) {
      return false;
    }

    if (!deepEqual(a[key], b[key])) {
      return false;
    }
  }

  return true;
}

export function sortObject(obj: Record<string, any>): Record<string, any> {
  return Object.keys(obj)
    .sort()
    .reduce(
      (result, key) => {
        result[key] = obj[key];
        return result;
      },
      {} as Record<string, any>
    );
}

export function serialize(obj: Record<string, any>): string {
  const sortedObj = sortObject(obj);
  return JSON.stringify(sortedObj);
}
