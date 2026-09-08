/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AiChatWithKbTask,
  ChunkRetrievalTask,
  ChunkVectorUpsertTask,
  DocumentUpsertTask,
  HierarchyJoinTask,
  KbAddDocumentTask,
  KbDeleteTask,
  KbReindexTask,
  KbSearchTask,
  KbToDocumentsTask,
  TextRerankerTask,
} from "@workglow/ai";
import type { EntitlementDeclaringTaskClass } from "@workglow/task-graph";
import {
  describeTaskClassReach,
  Entitlements,
  taskClassNeedsApproval,
  taskClassReach,
} from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

/**
 * A knowledge base is durable state a caller does not otherwise reach, so a task
 * touching one has to say so: the approval gate reads the class, and a class that
 * declares nothing is indistinguishable from one that reaches nothing. Deleting a
 * document behind a card reading "(nothing beyond running a model)" is the case
 * these pin.
 */
const READS = [
  ["KbSearchTask", KbSearchTask],
  ["KbToDocumentsTask", KbToDocumentsTask],
  ["HierarchyJoinTask", HierarchyJoinTask],
  ["AiChatWithKbTask", AiChatWithKbTask],
  ["ChunkRetrievalTask", ChunkRetrievalTask],
] as const satisfies readonly (readonly [string, EntitlementDeclaringTaskClass])[];

const WRITES = [
  ["KbDeleteTask", KbDeleteTask],
  ["KbAddDocumentTask", KbAddDocumentTask],
  ["DocumentUpsertTask", DocumentUpsertTask],
  ["ChunkVectorUpsertTask", ChunkVectorUpsertTask],
  ["KbReindexTask", KbReindexTask],
] as const satisfies readonly (readonly [string, EntitlementDeclaringTaskClass])[];

describe("knowledge-base tasks declare the storage they reach", () => {
  it.each(READS)("%s declares storage:read", (_name, cls) => {
    const ids = taskClassReach(cls).map((e) => e.id);
    expect(ids).toContain(Entitlements.STORAGE_READ);
  });

  it.each(WRITES)("%s declares storage:write", (_name, cls) => {
    const ids = taskClassReach(cls).map((e) => e.id);
    expect(ids).toContain(Entitlements.STORAGE_WRITE);
  });

  it.each([...READS, ...WRITES])("%s needs approval before it runs", (_name, cls) => {
    expect(taskClassNeedsApproval(cls)).toBe(true);
  });

  it.each([...READS, ...WRITES])("%s never describes itself as reaching nothing", (_name, cls) => {
    expect(describeTaskClassReach(cls)).not.toBe("(nothing beyond running a model)");
  });

  it("keeps the inference its AI base class declares when adding storage", () => {
    // `entitlements()` REPLACES the inherited declaration, so a subclass that
    // returns only its own storage silently drops what its base said it does.
    const ids = AiChatWithKbTask.entitlements().entitlements.map((e) => e.id);
    expect(ids).toContain(Entitlements.AI_INFERENCE);
    expect(ids).toContain(Entitlements.STORAGE_READ);
  });

  it("leaves a pure reranker ungated — it takes documents, not a knowledge base", () => {
    // Its input ports are query/documents/topK/model. The only `kb.` in the file
    // is a comment saying a KB invokes THIS task; the dependency runs the other
    // way, and gating it would put a click in front of ordinary scoring.
    expect(taskClassNeedsApproval(TextRerankerTask)).toBe(false);
    expect(taskClassReach(TextRerankerTask)).toEqual([]);
  });

  it("does not claim ChunkRetrievalTask writes, because it only searches", () => {
    // It names `installTextIndex` in an error message telling the caller how to
    // fix a missing index, and never calls it — and that method assigns a field
    // rather than touching storage anyway. `hybridSearch` throws without an
    // index rather than installing one. Over-declaring reach costs the same as
    // under-declaring it: a prompt that overstates is a prompt people stop reading.
    const ids = taskClassReach(ChunkRetrievalTask).map((e) => e.id);
    expect(ids).not.toContain(Entitlements.STORAGE_WRITE);
    expect(ids).toContain(Entitlements.STORAGE_READ);
  });
});
