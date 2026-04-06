/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "../di/ServiceRegistry";
import type { ServiceRegistry } from "../di/ServiceRegistry";
import { registerInputCompactor } from "../di/InputCompactorRegistry";
import { registerInputResolver } from "../di/InputResolverRegistry";
import { CREDENTIAL_STORE } from "./ICredentialStore";
import type { ICredentialStore } from "./ICredentialStore";
import { InMemoryCredentialStore } from "./InMemoryCredentialStore";

// Register default in-memory factory if not already registered
if (!globalServiceRegistry.has(CREDENTIAL_STORE)) {
  globalServiceRegistry.register(
    CREDENTIAL_STORE,
    (): ICredentialStore => new InMemoryCredentialStore(),
    true
  );
}

/**
 * Gets the global credential store instance
 */
export function getGlobalCredentialStore(): ICredentialStore {
  return globalServiceRegistry.get(CREDENTIAL_STORE);
}

/**
 * Sets the global credential store instance
 */
export function setGlobalCredentialStore(store: ICredentialStore): void {
  globalServiceRegistry.registerInstance(CREDENTIAL_STORE, store);
}

/**
 * Resolves a credential from the store registered in the given registry,
 * falling back to the global credential store.
 *
 * Intended for use in provider `getClient` functions and tasks.
 *
 * @param key The credential key to resolve
 * @param registry Optional service registry (e.g., from task context)
 * @returns The credential value, or undefined if not found
 */
export async function resolveCredential(
  key: string,
  registry?: ServiceRegistry
): Promise<string | undefined> {
  const store =
    registry && registry.has(CREDENTIAL_STORE)
      ? registry.get<ICredentialStore>(CREDENTIAL_STORE)
      : getGlobalCredentialStore();

  return store.get(key);
}

// Register "credential" input resolver so resolveSchemaInputs can resolve
// credential_key properties annotated with format: "credential" automatically.
// Returns undefined (rather than throwing) when the key isn't found, so
// downstream code (e.g., provider getClient) can fall back to env vars.
registerInputResolver("credential", async (id, _format, registry) => {
  return (await resolveCredential(id, registry)) ?? id;
});

// Credentials are already strings — pass through unchanged
registerInputCompactor("credential", (value) => {
  return typeof value === "string" ? value : undefined;
});
