/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * CLI for managing the encrypted credential store at .secrets/credentials/.
 *
 * Usage:
 *   bun scripts/credentials.ts set <key> [value]
 *   bun scripts/credentials.ts get <key>
 *   bun scripts/credentials.ts list
 *   bun scripts/credentials.ts delete <key>
 *   bun scripts/credentials.ts import-env
 *   bun scripts/credentials.ts rotate <new-passphrase>
 *
 * The passphrase is read from $WORKGLOW_SECRETS_PASSPHRASE. Encrypted
 * ciphertext is stored in .secrets/credentials/ as JSON files (one per key)
 * and is safe to commit. Only the passphrase is sensitive.
 *
 * Known credential keys (mapped to env vars at test setup):
 *   anthropic-api-key  → ANTHROPIC_API_KEY
 *   openai-api-key     → OPENAI_API_KEY
 *   google-api-key     → GOOGLE_API_KEY
 *   gemini-api-key     → GEMINI_API_KEY
 *   hf-token           → HF_TOKEN
 */

import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { buildCredentialStore, CREDENTIAL_TO_ENV, PASSPHRASE_ENV, SECRETS_DIR } from "./lib/test-credentials";

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function requirePassphrase(): string {
  const p = process.env[PASSPHRASE_ENV];
  if (!p) {
    fail(
      `${PASSPHRASE_ENV} is not set. Pick a strong passphrase, store it in your OS keychain or CI secret, then export it before running this command.`
    );
  }
  return p;
}

async function readSecretInteractive(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  const stdin = process.stdin;
  stdin.setEncoding("utf8");
  return new Promise((resolveValue) => {
    let buf = "";
    const onData = (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        stdin.off("data", onData);
        stdin.pause();
        resolveValue(buf.slice(0, nl).trimEnd());
      }
    };
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function cmdSet(key: string, valueArg: string | undefined): Promise<void> {
  const passphrase = requirePassphrase();
  mkdirSync(SECRETS_DIR, { recursive: true });
  const value = valueArg ?? (await readSecretInteractive(`Enter value for "${key}": `));
  if (!value) fail("empty value");
  const { encrypted } = buildCredentialStore(passphrase);
  await encrypted.put(key, value, { provider: providerForKey(key) });
  console.log(`stored "${key}"`);
}

async function cmdGet(key: string): Promise<void> {
  const passphrase = requirePassphrase();
  const { encrypted } = buildCredentialStore(passphrase);
  const value = await encrypted.get(key);
  if (value === undefined) fail(`no such key: ${key}`);
  process.stdout.write(value);
  if (process.stdout.isTTY) process.stdout.write("\n");
}

async function cmdList(): Promise<void> {
  const passphrase = requirePassphrase();
  const { encrypted } = buildCredentialStore(passphrase);
  const keys = await encrypted.keys();
  if (keys.length === 0) {
    console.log("(no credentials stored)");
    return;
  }
  for (const k of [...keys].sort()) {
    const env = CREDENTIAL_TO_ENV[k];
    console.log(env ? `${k}  →  ${env}` : k);
  }
}

async function cmdDelete(key: string): Promise<void> {
  const passphrase = requirePassphrase();
  const { encrypted } = buildCredentialStore(passphrase);
  const ok = await encrypted.delete(key);
  console.log(ok ? `deleted "${key}"` : `no such key: ${key}`);
}

async function cmdImportEnv(): Promise<void> {
  const passphrase = requirePassphrase();
  mkdirSync(SECRETS_DIR, { recursive: true });
  const { encrypted } = buildCredentialStore(passphrase);
  const imported: string[] = [];
  for (const [credKey, envVar] of Object.entries(CREDENTIAL_TO_ENV)) {
    const v = process.env[envVar];
    if (!v) continue;
    await encrypted.put(credKey, v, { provider: providerForKey(credKey) });
    imported.push(`${envVar} → ${credKey}`);
  }
  if (imported.length === 0) {
    console.log("(no known credential env vars set in this shell)");
    return;
  }
  console.log("imported:");
  for (const line of imported) console.log(`  ${line}`);
}

async function cmdRotate(newPassphrase: string): Promise<void> {
  const oldPassphrase = requirePassphrase();
  if (!newPassphrase) fail("usage: rotate <new-passphrase>");
  if (newPassphrase === oldPassphrase) fail("new passphrase must differ from old");

  const { encrypted: oldStore } = buildCredentialStore(oldPassphrase);
  const keys = await oldStore.keys();
  if (keys.length === 0) {
    console.log("(no credentials stored — nothing to rotate)");
    return;
  }
  const decrypted = await Promise.all(
    keys.map(async (k) => [k, await oldStore.get(k)] as const)
  );

  // Wipe ciphertext files, then re-encrypt under the new passphrase.
  for (const file of readdirSync(SECRETS_DIR)) unlinkSync(`${SECRETS_DIR}/${file}`);

  const { encrypted: newStore } = buildCredentialStore(newPassphrase);
  for (const [k, v] of decrypted) {
    if (v !== undefined) await newStore.put(k, v, { provider: providerForKey(k) });
  }
  console.log(
    `rotated ${keys.length} credential(s). Update ${PASSPHRASE_ENV} in your keychain / CI secret to the new value.`
  );
}

function providerForKey(key: string): string | undefined {
  if (key.startsWith("anthropic")) return "anthropic";
  if (key.startsWith("openai")) return "openai";
  if (key.startsWith("google") || key.startsWith("gemini")) return "google";
  if (key.startsWith("hf")) return "huggingface";
  return undefined;
}

function usage(): never {
  console.log(
    [
      "Usage:",
      "  bun scripts/credentials.ts set <key> [value]",
      "  bun scripts/credentials.ts get <key>",
      "  bun scripts/credentials.ts list",
      "  bun scripts/credentials.ts delete <key>",
      "  bun scripts/credentials.ts import-env",
      "  bun scripts/credentials.ts rotate <new-passphrase>",
      "",
      `Requires ${PASSPHRASE_ENV} to be set. See .secrets/README.md.`,
    ].join("\n")
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "set":
      if (!args[0]) usage();
      await cmdSet(args[0], args[1]);
      break;
    case "get":
      if (!args[0]) usage();
      await cmdGet(args[0]);
      break;
    case "list":
      await cmdList();
      break;
    case "delete":
      if (!args[0]) usage();
      await cmdDelete(args[0]);
      break;
    case "import-env":
      await cmdImportEnv();
      break;
    case "rotate":
      if (!args[0]) usage();
      await cmdRotate(args[0]);
      break;
    default:
      usage();
  }
}

await main();
