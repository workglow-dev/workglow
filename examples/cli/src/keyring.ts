/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { OtpPassphraseCache } from "@workglow/util";
import { FsFolderJsonKvStorage, LazyEncryptedCredentialStore } from "@workglow/storage";
import { Entry } from "@napi-rs/keyring";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const KEYRING_SERVICE = "workglow";
const KEYRING_ACCOUNT = "credential-passphrase";

const workglowDir = path.join(homedir(), ".workglow");
const credentialsDir = path.join(workglowDir, "credentials");
const credentialKeyPath = path.join(workglowDir, ".credential-key");

/**
 * Lazy credential store backed by encrypted file-based KV storage.
 * Starts locked; call {@link ensureCredentialStoreUnlocked} before
 * accessing encrypted credentials.
 */
export const lazyStore = new LazyEncryptedCredentialStore(
  new FsFolderJsonKvStorage(credentialsDir)
);

/**
 * In-memory OTP-masked passphrase cache with 6-hour hard TTL.
 * When the cache expires the lazy store is automatically locked.
 */
export const passphraseCache = new OtpPassphraseCache({
  hardTtlMs: 6 * 60 * 60 * 1000,
  onExpiry: () => lazyStore.lock(),
});

function isFsCode(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === code
  );
}

/**
 * Resolves the credential passphrase from (in priority order):
 * 1. `WORKGLOW_CREDENTIAL_PASSPHRASE` environment variable
 * 2. OS keyring via `@napi-rs/keyring`
 * 3. Legacy `~/.workglow/.credential-key` file (migrates to keyring, then deletes file)
 * 4. Generates a new random passphrase and stores it in the keyring
 */
export async function resolvePassphraseFromKeyring(): Promise<string> {
  // 1. Environment variable override
  if (process.env.WORKGLOW_CREDENTIAL_PASSPHRASE) {
    return process.env.WORKGLOW_CREDENTIAL_PASSPHRASE;
  }

  // 2. Try OS keyring
  const entry = new Entry(KEYRING_SERVICE, KEYRING_ACCOUNT);
  try {
    const existing = entry.getPassword();
    if (existing) return existing;
  } catch {
    // Keyring not available or no entry — fall through
  }

  // 3. Migrate from legacy file-based storage
  try {
    const fileKey = (await readFile(credentialKeyPath, "utf-8")).trim();
    if (fileKey) {
      try {
        entry.setPassword(fileKey);
        // Migration successful — remove the old file
        await unlink(credentialKeyPath);
      } catch {
        // Keyring write failed; leave file in place as active store
      }
      return fileKey;
    }
  } catch (err) {
    if (!isFsCode(err, "ENOENT")) throw err;
    // File doesn't exist — fall through to generate
  }

  // 4. Generate new passphrase
  const key = randomBytes(32).toString("hex");
  try {
    entry.setPassword(key);
  } catch {
    // Keyring unavailable — fall back to file storage
    await mkdir(path.dirname(credentialKeyPath), { recursive: true });
    try {
      await writeFile(credentialKeyPath, key, { mode: 0o600, flag: "wx" });
    } catch (writeErr) {
      if (isFsCode(writeErr, "EEXIST")) {
        return (await readFile(credentialKeyPath, "utf-8")).trim();
      }
      throw writeErr;
    }
  }
  return key;
}

/**
 * Ensures the lazy credential store is unlocked and ready for use.
 * Retrieves the passphrase from the OTP cache if still valid, otherwise
 * resolves it from the keyring (or generates a new one).
 */
export async function ensureCredentialStoreUnlocked(): Promise<void> {
  if (lazyStore.isUnlocked) return;

  // Try OTP cache first
  const cached = passphraseCache.retrieve();
  if (cached) {
    lazyStore.unlock(cached);
    return;
  }

  // Resolve from keyring / file / generate
  const passphrase = await resolvePassphraseFromKeyring();
  passphraseCache.store(passphrase);
  lazyStore.unlock(passphrase);
}
