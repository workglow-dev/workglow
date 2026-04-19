/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from "node:child_process";
import process from "node:process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type EditInEditorResult =
  | { readonly status: "saved"; readonly content: string }
  | { readonly status: "unchanged" }
  | { readonly status: "editor_error"; readonly message: string };

/**
 * Shell command prefix for opening a file (same precedence as git: GIT_EDITOR, VISUAL, EDITOR).
 */
export function getEditorCommand(): string {
  const fallback = process.platform === "win32" ? "notepad" : "vi";
  return process.env.GIT_EDITOR ?? process.env.VISUAL ?? process.env.EDITOR ?? fallback;
}

/**
 * Minimal POSIX shell-word splitter. Handles unquoted whitespace separators
 * plus matched single/double quotes. Intentionally does NOT interpret shell
 * metacharacters — an editor env var like `vim; rm -rf ~` splits into
 * `["vim;", "rm", "-rf", "~"]` and is passed to execFileSync with shell:false,
 * so the literal string `vim;` is treated as a binary name (which won't exist)
 * rather than being interpreted by a shell.
 */
function splitEditorCommand(cmd: string): string[] {
  const args: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (/\s/.test(ch) && !inSingle && !inDouble) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current) args.push(current);
  return args;
}

/**
 * Writes `initialContent` to a temp file, launches the user's editor, then reads the file back.
 * Same idea as `git commit`: unchanged buffer ⇒ cancel; non-zero editor exit ⇒ error.
 */
export function editStringInExternalEditor(
  initialContent: string,
  tempBasename: string
): EditInEditorResult {
  const dir = mkdtempSync(join(tmpdir(), "workglow-edit-"));
  const file = join(dir, tempBasename);
  writeFileSync(file, initialContent, "utf-8");

  try {
    const parts = splitEditorCommand(getEditorCommand());
    if (parts.length === 0) {
      throw new Error("No editor configured (GIT_EDITOR/VISUAL/EDITOR is empty)");
    }
    const [editorBin, ...editorArgs] = parts;
    editorArgs.push(file);
    execFileSync(editorBin, editorArgs, { stdio: "inherit" });
  } catch (e) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    return { status: "editor_error", message: e instanceof Error ? e.message : String(e) };
  }

  let after: string;
  try {
    after = readFileSync(file, "utf-8");
  } catch (e) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    return { status: "editor_error", message: e instanceof Error ? e.message : String(e) };
  }

  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  if (after === initialContent) {
    return { status: "unchanged" };
  }

  return { status: "saved", content: after };
}
