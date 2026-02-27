/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CredentialPutOptions,
  ICredentialStore,
} from "@workglow/util";
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
 * Derives a 256-bit AES-GCM key from a passphrase using PBKDF2.
 */
async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as unknown as ArrayBuffer, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encrypt(plaintext: string, passphrase: string): Promise<{ encrypted: string; iv: string }> {
  const enc = new TextEncoder();
  // Use a fixed salt derived from the passphrase so we get a deterministic key
  // (the random IV still ensures ciphertext uniqueness)
  const salt = enc.encode(passphrase.padEnd(16, "\0").slice(0, 16));
  const key = await deriveKey(passphrase, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext)
  );
  return {
    encrypted: bufToBase64(new Uint8Array(ciphertext)),
    iv: bufToBase64(iv),
  };
}

async function decrypt(encrypted: string, iv: string, passphrase: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = enc.encode(passphrase.padEnd(16, "\0").slice(0, 16));
  const key = await deriveKey(passphrase, salt);
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBuf(iv) as unknown as ArrayBuffer },
    key,
    base64ToBuf(encrypted) as unknown as ArrayBuffer
  );
  return new TextDecoder().decode(plainBuf);
}

function bufToBase64(buf: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buf.length; i++) {
    binary += String.fromCharCode(buf[i]);
  }
  return btoa(binary);
}

function base64ToBuf(b64: string): Uint8Array {
  const binary = atob(b64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    buf[i] = binary.charCodeAt(i);
  }
  return buf;
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
  constructor(
    private readonly kv: IKvStorage<string, any, any>,
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

    return decrypt(raw.encrypted, raw.iv, this.passphrase);
  }

  async put(key: string, value: string, options?: CredentialPutOptions): Promise<void> {
    const now = new Date();
    const existing = (await this.kv.get(key)) as StoredCredential | undefined;

    const { encrypted, iv } = await encrypt(value, this.passphrase);

    const stored: StoredCredential = {
      encrypted,
      iv,
      label: options?.label ?? existing?.label,
      provider: options?.provider ?? existing?.provider,
      createdAt: existing?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: options?.expiresAt?.toISOString(),
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
      const record = entry as { key: string; value: StoredCredential };
      if (record.value.expiresAt && new Date(record.value.expiresAt) <= now) {
        await this.kv.delete(record.key);
        continue;
      }
      result.push(record.key);
    }
    return result;
  }

  async deleteAll(): Promise<void> {
    await this.kv.deleteAll();
  }
}
