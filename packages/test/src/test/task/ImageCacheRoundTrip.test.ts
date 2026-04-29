/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import "@workglow/util/media";
import "@workglow/tasks";
import { ImageBlurTask } from "@workglow/tasks";
import {
  CpuImage,
  type GpuImage,
} from "@workglow/util/media";
import {
  TaskOutputRepository,
  type TaskInput,
  type TaskOutput,
} from "@workglow/task-graph";

class MapRepo extends TaskOutputRepository {
  store = new Map<string, TaskOutput>();

  constructor() {
    super({ outputCompression: false });
  }

  async saveOutput(_t: string, inputs: TaskInput, output: TaskOutput): Promise<void> {
    this.store.set(JSON.stringify(inputs), output);
  }

  async getOutput(_t: string, inputs: TaskInput): Promise<TaskOutput | undefined> {
    return this.store.get(JSON.stringify(inputs));
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  async size(): Promise<number> {
    return this.store.size;
  }

  async clearOlderThan(_olderThanInMs: number): Promise<void> {}
}

describe("image cache round-trip", () => {
  test("two equivalent GpuImages hit the same cache entry", async () => {
    const repo = new MapRepo();
    const bin = { data: new Uint8ClampedArray(8 * 8 * 4).fill(128), width: 8, height: 8, channels: 4 as const };
    const a = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
    const b = CpuImage.fromImageBinary({ ...bin, data: new Uint8ClampedArray(bin.data) }) as unknown as GpuImage;
    expect(a).not.toBe(b);

    const t = new ImageBlurTask();
    const r1 = await t.run({ image: a, radius: 1 } as never, { outputCache: repo });
    const r2 = await t.run({ image: b, radius: 1 } as never, { outputCache: repo });

    // Same materialize result.
    const ab = await ((r1 as { image: GpuImage }).image).materialize();
    const bb = await ((r2 as { image: GpuImage }).image).materialize();
    expect(Array.from(ab.data).slice(0, 32)).toEqual(Array.from(bb.data).slice(0, 32));

    // Single cache entry — Task 4.5's input normalization at work.
    expect(repo.store.size).toBe(1);
  });
});
