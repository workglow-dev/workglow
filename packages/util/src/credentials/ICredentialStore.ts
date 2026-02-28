/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "../di/ServiceRegistry";

/**
 * Metadata associated with a stored credential
 */
export interface CredentialMetadata {
  /** Human-readable label for the credential */
  readonly label: string | undefined;
  /** The provider this credential is associated with (e.g., "anthropic", "openai") */
  readonly provider: string | undefined;
  /** When the credential was created */
  readonly createdAt: Date;
  /** When the credential was last updated */
  readonly updatedAt: Date;
  /** When the credential expires (undefined = never) */
  readonly expiresAt: Date | undefined;
}

/**
 * A stored credential entry combining the secret value with its metadata
 */
export interface CredentialEntry {
  /** The credential key/name */
  readonly key: string;
  /** The secret value */
  readonly value: string;
  /** Associated metadata */
  readonly metadata: CredentialMetadata;
}

/**
 * Options for storing a credential
 */
export interface CredentialPutOptions {
  /** Human-readable label */
  readonly label?: string;
  /** Associated provider name */
  readonly provider?: string;
  /** Expiration date */
  readonly expiresAt?: Date;
}

/**
 * Interface defining the contract for credential/secret storage.
 *
 * Provides a unified abstraction for storing and retrieving sensitive values
 * (API keys, tokens, passwords) across different backends: in-memory,
 * environment variables, encrypted KV stores, or external secret managers
 * (AWS Secrets Manager, HashiCorp Vault, GCP Secret Manager).
 *
 * Implementations MUST NOT log or expose credential values in error messages.
 */
export interface ICredentialStore {
  /**
   * Retrieve a credential value by key.
   *
   * Returns the secret value if found and not expired, or `undefined` if the
   * credential does not exist or is expired.
   *
   * Implementations MAY reject the returned promise on backend, storage, or
   * cryptographic errors (e.g., I/O failure, decryption failure, corrupt data).
   * Such errors MUST NOT include credential secret values in their messages or
   * metadata.
   */
  get(key: string): Promise<string | undefined>;

  /**
   * Store a credential value.
   * @param key Unique identifier for the credential
   * @param value The secret value to store
   * @param options Optional metadata
   */
  put(key: string, value: string, options?: CredentialPutOptions): Promise<void>;

  /**
   * Delete a credential by key.
   * @returns true if the credential existed and was deleted, false otherwise.
   */
  delete(key: string): Promise<boolean>;

  /**
   * Check whether a credential exists (and is not expired).
   */
  has(key: string): Promise<boolean>;

  /**
   * List all credential keys (does NOT expose values).
   */
  keys(): Promise<readonly string[]>;

  /**
   * Delete all credentials.
   */
  deleteAll(): Promise<void>;
}

/**
 * Service token for the global credential store
 */
export const CREDENTIAL_STORE = createServiceToken<ICredentialStore>("credential.store");
