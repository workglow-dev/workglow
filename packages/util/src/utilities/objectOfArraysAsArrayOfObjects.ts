/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export type Cursor<T> = {
  length: number;
  next: () => IteratorResult<T>;
  [Symbol.iterator]: () => Iterator<T>;
};
/**
 * Creates a proxy that treats an object-of-arrays as an array-of-objects.
 * It lazily computes each row when accessed and lets you update or add new rows.
 *
 * When adding a new object (either via .push or assignment to the next index),
 * the underlying arrays are updated accordingly.
 *
 * @param data An object whose properties are arrays (assumed to have equal lengths)
 * @returns A proxy that behaves like an array of objects backed by the input arrays
 */
export function objectOfArraysAsArrayOfObjects<T extends Record<string, any>>(data: {
  [K in keyof T]: T[K][];
}): Array<T> & { cursor: () => Cursor<T> } {
  const keys = Object.keys(data) as (keyof T)[];
  const length = data[keys[0]].length;
  for (const key of keys) {
    if (data[key].length !== length) {
      console.error("All arrays must have the same length", key, data[key].length, length, data);
      throw new Error("All arrays must have the same length");
    }
  }

  const indexSymbol = Symbol("index");

  /**
   * Creates a live row proxy for the given index.
   * The proxy intercepts get/set operations so that reads and writes
   * go directly to data[key][index].
   */
  function createRowProxy(index: number): T & { [indexSymbol]: number } {
    let currentIndex = index;
    return new Proxy({} as T & { [indexSymbol]: number }, {
      get(_target, prop, receiver) {
        if (currentIndex < 0 || currentIndex >= data[keys[0]].length) {
          return undefined;
        }
        if (typeof prop === "string" && keys.includes(prop as keyof T)) {
          return data[prop as keyof T][currentIndex];
        }
        if (prop === indexSymbol) {
          return currentIndex;
        }
        return Reflect.get(_target, prop, receiver);
      },
      set(_target, prop, value, receiver) {
        if (currentIndex < 0 || currentIndex >= data[keys[0]].length) {
          return false;
        }
        if (typeof prop === "string" && keys.includes(prop as keyof T)) {
          data[prop as keyof T][currentIndex] = value;
          return true;
        }
        if (prop === indexSymbol) {
          currentIndex = value;
          return true;
        }
        return Reflect.set(_target, prop, value, receiver);
      },
      ownKeys(_target) {
        return keys as string[];
      },
      getOwnPropertyDescriptor(_target, prop) {
        if (typeof prop === "string" && keys.includes(prop as keyof T)) {
          return { enumerable: true, configurable: true };
        }
        return undefined;
      },
    });
  }

  function createCursor(): Cursor<T> {
    // Determine the keys and the effective number of rows.
    let currentIndex = 0;

    // The cursor object that will be updated for each row.
    const cursor = createRowProxy(0);

    const obj = {
      get length() {
        return data[keys[0]].length;
      },
      /**
       * Returns the next row via the cursor.
       */
      next(): IteratorResult<T> {
        if (currentIndex < length) {
          cursor[indexSymbol] = currentIndex;
          currentIndex++;
          return { done: false, value: cursor };
        } else {
          return { done: true, value: undefined as any };
        }
      },
      /**
       * Makes the object iterable.
       */
      [Symbol.iterator](): Iterator<T> {
        // Reset the cursor for a fresh iteration.
        currentIndex = 0;
        cursor[indexSymbol] = currentIndex;
        return obj;
      },
    };
    return obj as Cursor<T>;
  }

  // Helper: shallow equality comparison between two rows.
  function shallowEqual(index: number, row: T): boolean {
    for (const key of keys) {
      if (data[key][index] !== row[key]) return false;
    }
    return true;
  }

  return new Proxy([] as Array<T>, {
    get(target, prop, receiver) {
      // Always return the current length dynamically.
      if (prop === "length") {
        return data[keys[0]].length;
      }

      // Create a cursor iterator.
      if (prop === "cursor") {
        return function () {
          return createCursor();
        };
      }

      // Override reverse to reverse the underlying arrays.
      if (prop === "reverse") {
        return function () {
          for (const key of keys) {
            data[key].reverse();
          }
          return receiver;
        };
      }

      // Override push to add a new object to the underlying arrays.
      if (prop === "push") {
        return function (...args: T[]) {
          for (const item of args) {
            for (const key of keys) {
              data[key].push(item[key]);
            }
          }
          return data[keys[0]].length;
        };
      }

      // Override pop to remove the last row from the underlying arrays and return it.
      if (prop === "pop") {
        return function () {
          const len = data[keys[0]].length;
          if (len === 0) return undefined;
          const poppedRow = {} as T;
          // Remove last element from each array and assemble the row to return.
          for (const key of keys) {
            poppedRow[key] = data[key].pop() as T[keyof T];
          }
          return poppedRow;
        };
      }

      // Override unshift to add a new row (or rows) at the beginning.
      if (prop === "unshift") {
        return function (...args: T[]) {
          // To preserve order, iterate from the last argument to the first.
          for (let i = args.length - 1; i >= 0; i--) {
            const item = args[i];
            for (const key of keys) {
              data[key].unshift(item[key]);
            }
          }
          return data[keys[0]].length;
        };
      }

      // Override shift to remove the first row from the underlying arrays and return it.
      if (prop === "shift") {
        return function () {
          if (data[keys[0]].length === 0) return undefined;
          const shiftedRow = {} as T;
          for (const key of keys) {
            shiftedRow[key] = data[key].shift() as T[keyof T];
          }
          return shiftedRow;
        };
      }

      // Override splice to remove or replace elements at a specific index.
      if (prop === "splice") {
        return function (start: number, deleteCount?: number, ...items: T[]) {
          const len = data[keys[0]].length;
          // Normalize start index.
          if (start < 0) {
            start = len + start;
            if (start < 0) start = 0;
          }
          if (deleteCount === undefined) {
            deleteCount = len - start;
          }
          // For each key, perform splice and capture removed elements.
          const removedByKey: { [K in keyof T]: T[K][] } = {} as any;
          for (const key of keys) {
            removedByKey[key] = data[key].splice(
              start,
              deleteCount,
              ...items.map((item) => item[key])
            );
          }
          // Combine removed elements into an array of objects.
          const removed: T[] = [];
          for (let i = 0; i < deleteCount; i++) {
            const row = {} as T;
            for (const key of keys) {
              row[key] = removedByKey[key][i];
            }
            removed.push(row);
          }
          return removed;
        };
      }

      // Override sort to sort the underlying arrays.
      // TODO(str): This is a bit of a hack. We should probably use a more efficient
      // way to do this.
      if (prop === "sort") {
        return function (compareFn?: (a: T, b: T) => number) {
          // Build an array of rows.
          const rows = [...receiver];
          // Sort rows.
          rows.sort(compareFn);
          // Write back sorted rows.
          for (const key of keys) {
            data[key] = rows.map((row) => row[key]);
          }
          return receiver;
        };
      }

      // Non-mutating Methods: now rewritten as follows.
      if (prop === "includes") {
        return function (searchElement: T, fromIndex?: number) {
          const len = data[keys[0]].length;
          let start = fromIndex ?? 0;
          if (start < 0) {
            start = Math.max(0, len + start);
          }
          for (let i = start; i < len; i++) {
            if (shallowEqual(i, searchElement)) return true;
          }
          return false;
        };
      }
      if (prop === "indexOf") {
        return function (searchElement: T, fromIndex?: number) {
          const len = data[keys[0]].length;
          let start = fromIndex ?? 0;
          if (start < 0) {
            start = Math.max(0, len + start);
          }
          for (let i = start; i < len; i++) {
            if (shallowEqual(i, searchElement)) return i;
          }
          return -1;
        };
      }
      if (prop === "lastIndexOf") {
        return function (searchElement: T, fromIndex?: number) {
          const len = data[keys[0]].length;
          // Default start index is the last element.
          let start = fromIndex ?? len - 1;
          if (start < 0) {
            start = len + start;
          }
          for (let i = start; i >= 0; i--) {
            if (shallowEqual(i, searchElement)) return i;
          }
          return -1;
        };
      }

      // Non-mutating methods implemented via an array of object row proxies.
      if (prop === "forEach") {
        return function (callback: (value: T, index: number, array: T[]) => void, thisArg?: any) {
          return [...receiver].forEach(callback, thisArg);
        };
      }
      if (prop === "map") {
        return function (callback: (value: T, index: number, array: T[]) => any, thisArg?: any) {
          return [...receiver].map(callback, thisArg);
        };
      }
      if (prop === "filter") {
        return function (
          callback: (value: T, index: number, array: T[]) => boolean,
          thisArg?: any
        ) {
          return [...receiver].filter(callback, thisArg);
        };
      }
      if (prop === "reduce") {
        return function (
          callback: (accumulator: any, currentValue: T, currentIndex: number, array: T[]) => any,
          initialValue?: any
        ) {
          return [...receiver].reduce(callback, initialValue);
        };
      }
      if (prop === "find") {
        return function (
          callback: (value: T, index: number, array: T[]) => boolean,
          thisArg?: any
        ) {
          return [...receiver].find(callback, thisArg);
        };
      }
      if (prop === "every") {
        return function (
          callback: (value: T, index: number, array: T[]) => boolean,
          thisArg?: any
        ) {
          return [...receiver].every(callback, thisArg);
        };
      }
      if (prop === "some") {
        return function (
          callback: (value: T, index: number, array: T[]) => boolean,
          thisArg?: any
        ) {
          return [...receiver].some(callback, thisArg);
        };
      }

      // When a numeric index is accessed, build and return the corresponding row.
      if (typeof prop === "string" && !isNaN(Number(prop))) {
        const index = Number(prop);
        if (index < 0 || index >= data[keys[0]].length) {
          return undefined;
        }
        return createRowProxy(index);
      }

      // Allow iteration over the rows.
      if (prop === Symbol.iterator) {
        return function* () {
          for (let i = 0; i < data[keys[0]].length; i++) {
            yield createRowProxy(i);
          }
        };
      }

      // Delegate any other property access.
      return Reflect.get(target, prop, receiver);
    },
    set(target, prop, value, receiver) {
      // Intercept numeric index assignments.
      if (typeof prop === "string" && !isNaN(Number(prop))) {
        const index = Number(prop);
        if (index === data[keys[0]].length) {
          // Appending a new row.
          for (const key of keys) {
            data[key].push(value[key]);
          }
          return true;
        } else if (index < data[keys[0]].length) {
          // Updating an existing row.
          for (const key of keys) {
            if (value.hasOwnProperty(key)) {
              data[key][index] = value[key];
            }
          }
          return true;
        }
      }
      return Reflect.set(target, prop, value, receiver);
    },
    // Intercept deletion of properties to remove a row from each underlying array.
    deleteProperty(target, prop) {
      if (typeof prop === "string" && !isNaN(Number(prop))) {
        const index = Number(prop);
        if (index >= 0 && index < data[keys[0]].length) {
          // Remove the element at this index from every underlying array.
          for (const key of keys) {
            // slice mutates the array in place
            data[key].splice(index, 1);
          }
          return true;
        }
      }
      return Reflect.deleteProperty(target, prop);
    },
  }) as Array<T> & { cursor: () => Cursor<T> };
}
