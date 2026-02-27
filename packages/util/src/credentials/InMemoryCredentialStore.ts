/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CredentialEntry,
  CredentialMetadata,
  CredentialPutOptions,
  ICredentialStore,
} from "./ICredentialStore";

/**
 * In-memory credential store for development and testing.
 *
 * Credentials are stored in a plain Map and lost when the process exits.
 * NOT suitable for production use — use {@link EncryptedKvCredentialStore}
 * or an external secret manager integration instead.
 */
export class InMemoryCredentialStore implements ICredentialStore {
  private readonly store = new Map<string, CredentialEntry>();

  async get(key: string): Promise<string | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.metadata.expiresAt && entry.metadata.expiresAt <= new Date()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async put(key: string, value: string, options?: CredentialPutOptions): Promise<void> {
    const now = new Date();
    const existing = this.store.get(key);
    const metadata: CredentialMetadata = {
      label: options?.label ?? existing?.metadata.label,
      provider: options?.provider ?? existing?.metadata.provider,
      createdAt: existing?.metadata.createdAt ?? now,
      updatedAt: now,
      expiresAt: options?.expiresAt,
    };
    this.store.set(key, { key, value, metadata });
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  async has(key: string): Promise<boolean> {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (entry.metadata.expiresAt && entry.metadata.expiresAt <= new Date()) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  async keys(): Promise<readonly string[]> {
    const now = new Date();
    const result: string[] = [];
    for (const [key, entry] of this.store) {
      if (entry.metadata.expiresAt && entry.metadata.expiresAt <= now) {
        this.store.delete(key);
        continue;
      }
      result.push(key);
    }
    return result;
  }

  async deleteAll(): Promise<void> {
    this.store.clear();
  }
}
