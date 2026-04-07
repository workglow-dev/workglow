/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getGlobalCredentialStore } from "@workglow/util";
import type { Command } from "commander";
import { createInterface } from "node:readline";
import { ensureCredentialStoreUnlocked } from "../keyring";

/**
 * Prompts for a secret value with masked input (shows asterisks).
 */
async function promptSecret(message: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    // Mask the input by intercepting keystrokes
    const stdin = process.stdin;
    const stdout = process.stdout;
    const wasRaw = stdin.isRaw;

    stdout.write(message);
    stdin.setRawMode(true);
    stdin.resume();

    let input = "";
    const onData = (chunk: Buffer) => {
      const char = chunk.toString("utf-8");

      if (char === "\n" || char === "\r") {
        // Enter pressed
        stdin.removeListener("data", onData);
        stdin.setRawMode(wasRaw ?? false);
        stdout.write("\n");
        rl.close();
        resolve(input);
      } else if (char === "\u0003") {
        // Ctrl-C
        stdin.removeListener("data", onData);
        stdin.setRawMode(wasRaw ?? false);
        stdout.write("\n");
        rl.close();
        process.exit(0);
      } else if (char === "\u007F" || char === "\b") {
        // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1);
          stdout.write("\b \b");
        }
      } else if (char.charCodeAt(0) >= 32) {
        // Printable character
        input += char;
        stdout.write("*");
      }
    };

    stdin.on("data", onData);
  });
}

export function registerCredentialCommand(program: Command): void {
  const credential = program
    .command("credential")
    .description("Manage encrypted credentials");

  credential
    .command("add")
    .argument("<key>", "credential key (e.g., openai-api-key)")
    .description("Add or update an encrypted credential")
    .option("--provider <name>", "provider name (e.g., openai, anthropic)")
    .option("--label <text>", "human-readable label")
    .action(async (key: string, opts: { provider?: string; label?: string }) => {
      await ensureCredentialStoreUnlocked();

      let value: string;
      if (process.stdin.isTTY) {
        value = await promptSecret("Enter credential value: ");
        if (!value) {
          console.error("No value provided.");
          process.exit(1);
        }
      } else {
        // Read from stdin pipe
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk);
        }
        value = Buffer.concat(chunks).toString("utf-8").trim();
      }

      const store = getGlobalCredentialStore();
      await store.put(key, value, {
        provider: opts.provider,
        label: opts.label,
      });
      console.log(`Credential "${key}" saved.`);
    });

  credential
    .command("list")
    .description("List all stored credential keys")
    .action(async () => {
      await ensureCredentialStoreUnlocked();

      const store = getGlobalCredentialStore();
      const keys = await store.keys();
      if (keys.length === 0) {
        console.log("No credentials stored.");
        return;
      }
      for (const key of keys) {
        console.log(key);
      }
    });

  credential
    .command("get")
    .argument("<key>", "credential key to retrieve")
    .description("Retrieve and display a credential value")
    .action(async (key: string) => {
      await ensureCredentialStoreUnlocked();

      const store = getGlobalCredentialStore();
      const value = await store.get(key);
      if (value === undefined) {
        console.error(`Credential "${key}" not found.`);
        process.exit(1);
      }

      if (process.stdout.isTTY) {
        console.warn("Warning: credential value will be displayed in plaintext.");
      }
      console.log(value);
    });

  credential
    .command("delete")
    .argument("<key>", "credential key to delete")
    .description("Delete a stored credential")
    .action(async (key: string) => {
      await ensureCredentialStoreUnlocked();

      const store = getGlobalCredentialStore();
      const deleted = await store.delete(key);
      if (deleted) {
        console.log(`Credential "${key}" deleted.`);
      } else {
        console.error(`Credential "${key}" not found.`);
        process.exit(1);
      }
    });
}
