/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CredentialPutOptions, ICredentialStore } from "@workglow/util";
import type { IKvStorage } from "../kv/IKvStorage";
import { EncryptedKvCredentialStore } from "./EncryptedKvCredentialStore";

/**
 * An {@link ICredentialStore} wrapper that starts in a locked state and defers
 * construction of the underlying {@link EncryptedKvCredentialStore} until
 * {@link unlock} is called with a passphrase.
 *
 * **Locked behavior** (before {@link unlock}):
 * - `get()` returns `undefined` (falls through in a {@link ChainedCredentialStore})
 * - `has()` returns `false`
 * - `keys()` returns `[]`
 * - `put()` throws an error
 * - `delete()` returns `false`
 * - `deleteAll()` is a no-op
 *
 * **Unlocked behavior**: all methods delegate to the inner
 * {@link EncryptedKvCredentialStore}.
 *
 * @example
 * ```ts
 * const lazy = new LazyEncryptedCredentialStore(kvStorage);
 * await lazy.get("key"); // undefined (locked)
 *
 * lazy.unlock("my-passphrase");
 * await lazy.get("key"); // decrypted value
 *
 * lazy.lock(); // discards inner store
 * await lazy.get("key"); // undefined again
 * ```
 */
export class LazyEncryptedCredentialStore implements ICredentialStore {
  private inner: EncryptedKvCredentialStore | undefined;

  constructor(private readonly kv: IKvStorage<string, unknown>) {}

  /**
   * Whether the store is currently unlocked and able to decrypt credentials.
   */
  get isUnlocked(): boolean {
    return this.inner !== undefined;
  }

  /**
   * Unlock the store by providing a passphrase. Creates the underlying
   * {@link EncryptedKvCredentialStore} using the same KV backend.
   *
   * @throws if the passphrase is empty
   */
  unlock(passphrase: string): void {
    this.inner = new EncryptedKvCredentialStore(this.kv as IKvStorage<string, any>, passphrase);
  }

  /**
   * Lock the store, discarding the inner {@link EncryptedKvCredentialStore}
   * and its derived key cache.
   */
  lock(): void {
    this.inner = undefined;
  }

  async get(key: string): Promise<string | undefined> {
    if (!this.inner) return undefined;
    return this.inner.get(key);
  }

  async put(key: string, value: string, options?: CredentialPutOptions): Promise<void> {
    if (!this.inner) {
      throw new Error("Credential store is locked. Call unlock() before storing credentials.");
    }
    return this.inner.put(key, value, options);
  }

  async delete(key: string): Promise<boolean> {
    if (!this.inner) return false;
    return this.inner.delete(key);
  }

  async has(key: string): Promise<boolean> {
    if (!this.inner) return false;
    return this.inner.has(key);
  }

  async keys(): Promise<readonly string[]> {
    if (!this.inner) return [];
    return this.inner.keys();
  }

  async deleteAll(): Promise<void> {
    if (!this.inner) return;
    return this.inner.deleteAll();
  }
}
