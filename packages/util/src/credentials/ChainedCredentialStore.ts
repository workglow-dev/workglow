/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CredentialPutOptions, ICredentialStore } from "./ICredentialStore";

/**
 * A credential store that chains multiple stores together, trying each
 * in order until a value is found.
 *
 * Writes always go to the first (primary) store. Reads cascade through
 * the chain, returning the first match. This enables layered resolution:
 * explicit config → encrypted store → environment variables.
 *
 * @example
 * ```ts
 * const store = new ChainedCredentialStore([
 *   new InMemoryCredentialStore(),  // runtime overrides
 *   new EncryptedKvCredentialStore(kv, passphrase),  // persistent encrypted
 *   new EnvCredentialStore({ ... }),  // environment fallback
 * ]);
 * ```
 */
export class ChainedCredentialStore implements ICredentialStore {
  constructor(private readonly stores: readonly ICredentialStore[]) {
    if (stores.length === 0) {
      throw new Error("ChainedCredentialStore requires at least one store.");
    }
  }

  async get(key: string): Promise<string | undefined> {
    for (const store of this.stores) {
      const value = await store.get(key);
      if (value !== undefined) return value;
    }
    return undefined;
  }

  async put(key: string, value: string, options?: CredentialPutOptions): Promise<void> {
    await this.stores[0].put(key, value, options);
  }

  async delete(key: string): Promise<boolean> {
    let deleted = false;
    for (const store of this.stores) {
      if (await store.delete(key)) {
        deleted = true;
      }
    }
    return deleted;
  }

  async has(key: string): Promise<boolean> {
    for (const store of this.stores) {
      if (await store.has(key)) return true;
    }
    return false;
  }

  async keys(): Promise<readonly string[]> {
    const seen = new Set<string>();
    for (const store of this.stores) {
      for (const key of await store.keys()) {
        seen.add(key);
      }
    }
    return [...seen];
  }

  async deleteAll(): Promise<void> {
    await Promise.all(this.stores.map((s) => s.deleteAll()));
  }
}
