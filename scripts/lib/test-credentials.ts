/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChainedCredentialStore } from "../../packages/util/src/credentials/ChainedCredentialStore";
import { EnvCredentialStore } from "../../packages/util/src/credentials/EnvCredentialStore";
import { setGlobalCredentialStore } from "../../packages/util/src/credentials/CredentialStoreRegistry";
import type { ICredentialStore } from "../../packages/util/src/credentials/ICredentialStore";
import { FsFolderJsonKvStorage } from "../../packages/storage/src/kv/FsFolderJsonKvStorage";
import { LazyEncryptedCredentialStore } from "../../packages/storage/src/credentials/LazyEncryptedCredentialStore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

export const SECRETS_DIR = path.join(REPO_ROOT, ".secrets", "credentials");
export const PASSPHRASE_ENV = "WORKGLOW_SECRETS_PASSPHRASE";

export const CREDENTIAL_TO_ENV: Readonly<Record<string, string>> = {
  "anthropic-api-key": "ANTHROPIC_API_KEY",
  "openai-api-key": "OPENAI_API_KEY",
  "google-api-key": "GOOGLE_API_KEY",
  "gemini-api-key": "GEMINI_API_KEY",
  "hf-token": "HF_TOKEN",
};

export interface BuiltStore {
  readonly chained: ICredentialStore;
  readonly encrypted: LazyEncryptedCredentialStore;
  readonly unlocked: boolean;
}

/**
 * Build the chained credential store backed by the on-disk encrypted KV.
 * If `passphrase` is omitted, the encrypted layer stays locked and reads
 * fall through to the env layer.
 */
export function buildCredentialStore(passphrase: string | undefined): BuiltStore {
  const kv = new FsFolderJsonKvStorage(SECRETS_DIR);
  const encrypted = new LazyEncryptedCredentialStore(kv);
  if (passphrase) encrypted.unlock(passphrase);

  const env = new EnvCredentialStore({ ...CREDENTIAL_TO_ENV });
  const chained = new ChainedCredentialStore([encrypted, env]);
  return { chained, encrypted, unlocked: encrypted.isUnlocked };
}

/**
 * Install the chained store as the global credential store and (best-effort)
 * hydrate `process.env` for credentials we have a known env-var mapping for.
 *
 * Hydration only happens for keys NOT already present in `process.env`, so an
 * explicit shell export still wins. Returns the list of keys hydrated.
 */
export async function installAndHydrate(passphrase: string | undefined): Promise<{
  readonly unlocked: boolean;
  readonly hydrated: readonly string[];
}> {
  // No passphrase → leave the global store at its default (InMemoryCredentialStore).
  // Integration tests skip via their existing `process.env.*_API_KEY` checks.
  if (!passphrase) return { unlocked: false, hydrated: [] };

  const { chained, encrypted } = buildCredentialStore(passphrase);
  setGlobalCredentialStore(chained);

  if (!encrypted.isUnlocked) return { unlocked: false, hydrated: [] };

  const hydrated: string[] = [];
  for (const [credKey, envVar] of Object.entries(CREDENTIAL_TO_ENV)) {
    if (process.env[envVar]) continue;
    const value = await encrypted.get(credKey);
    if (value) {
      process.env[envVar] = value;
      hydrated.push(envVar);
    }
  }
  return { unlocked: true, hydrated };
}
