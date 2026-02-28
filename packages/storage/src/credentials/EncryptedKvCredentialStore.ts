/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CredentialPutOptions,
  ICredentialStore,
} from "@workglow/util";
import { decrypt, encrypt } from "@workglow/util";
import type { IKvStorage } from "../kv/IKvStorage";

/**
 * Serialized form of a credential stored in the KV backend
 */
interface StoredCredential {
  readonly encrypted: string;
  readonly iv: string;
  readonly label: string | undefined;
  readonly provider: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string | undefined;
}

/**
 * Credential store that encrypts values with AES-256-GCM before persisting
 * them to an {@link IKvStorage} backend.
 *
 * Works with any KV backend (SQLite, PostgreSQL, IndexedDB, in-memory, etc.).
 * Uses the Web Crypto API (available in Node 20+, Bun, and browsers).
 *
 * @example
 * ```ts
 * import { SqliteKvStorage } from "@workglow/storage";
 *
 * const kv = new SqliteKvStorage(":memory:");
 * const store = new EncryptedKvCredentialStore(kv, "my-encryption-key");
 *
 * await store.put("openai-api-key", "sk-...", { provider: "openai" });
 * const key = await store.get("openai-api-key"); // "sk-..."
 * ```
 */
export class EncryptedKvCredentialStore implements ICredentialStore {
  /** Per-instance cache of derived CryptoKey instances keyed by base64(salt). */
  private readonly keyCache = new Map<string, CryptoKey>();

  constructor(
    private readonly kv: IKvStorage<string, StoredCredential>,
    private readonly passphrase: string
  ) {
    if (!passphrase) {
      throw new Error("EncryptedKvCredentialStore requires a non-empty passphrase.");
    }
  }

  async get(key: string): Promise<string | undefined> {
    const raw = (await this.kv.get(key)) as StoredCredential | undefined;
    if (!raw) return undefined;

    if (raw.expiresAt && new Date(raw.expiresAt) <= new Date()) {
      await this.kv.delete(key);
      return undefined;
    }

    return decrypt(raw.encrypted, raw.iv, this.passphrase, this.keyCache);
  }

  async put(key: string, value: string, options?: CredentialPutOptions): Promise<void> {
    const now = new Date();
    const existing = (await this.kv.get(key)) as StoredCredential | undefined;

    const { encrypted, iv } = await encrypt(value, this.passphrase, this.keyCache);

    const stored: StoredCredential = {
      encrypted,
      iv,
      label: options?.label ?? existing?.label,
      provider: options?.provider ?? existing?.provider,
      createdAt: existing?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: options?.expiresAt ? options.expiresAt.toISOString() : existing?.expiresAt,
    };

    await this.kv.put(key, stored);
  }

  async delete(key: string): Promise<boolean> {
    const exists = (await this.kv.get(key)) !== undefined;
    if (exists) {
      await this.kv.delete(key);
    }
    return exists;
  }

  async has(key: string): Promise<boolean> {
    const raw = (await this.kv.get(key)) as StoredCredential | undefined;
    if (!raw) return false;

    if (raw.expiresAt && new Date(raw.expiresAt) <= new Date()) {
      await this.kv.delete(key);
      return false;
    }
    return true;
  }

  async keys(): Promise<readonly string[]> {
    const all = await this.kv.getAll();
    if (!all) return [];

    const now = new Date();
    const result: string[] = [];
    for (const entry of all) {
      if (entry.value.expiresAt && new Date(entry.value.expiresAt) <= now) {
        await this.kv.delete(entry.key);
        continue;
      }
      result.push(entry.key);
    }
    return result;
  }

  async deleteAll(): Promise<void> {
    await this.kv.deleteAll();
  }
}
