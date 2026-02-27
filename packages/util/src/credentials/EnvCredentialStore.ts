/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CredentialPutOptions, ICredentialStore } from "./ICredentialStore";

/**
 * Credential store backed by environment variables.
 *
 * Keys are mapped to environment variable names via an explicit mapping
 * or an optional prefix convention. This store is read-only for env vars
 * that already exist, but `put` can be used to set them for the current
 * process lifetime.
 *
 * @example
 * ```ts
 * const store = new EnvCredentialStore({
 *   "anthropic-api-key": "ANTHROPIC_API_KEY",
 *   "openai-api-key": "OPENAI_API_KEY",
 * });
 * const key = await store.get("anthropic-api-key"); // reads process.env.ANTHROPIC_API_KEY
 * ```
 */
export class EnvCredentialStore implements ICredentialStore {
  private readonly keyToEnvVar: Map<string, string>;
  private readonly prefix: string | undefined;

  /**
   * @param mapping Explicit credential-key → env-var-name mapping
   * @param prefix Optional prefix: if a key has no explicit mapping, try `PREFIX_KEY` (uppercased, hyphens → underscores)
   */
  constructor(mapping: Record<string, string> = {}, prefix?: string) {
    this.keyToEnvVar = new Map(Object.entries(mapping));
    this.prefix = prefix;
  }

  private resolveEnvVar(key: string): string {
    const explicit = this.keyToEnvVar.get(key);
    if (explicit) return explicit;

    if (this.prefix) {
      return `${this.prefix}_${key.toUpperCase().replace(/-/g, "_")}`;
    }

    return key.toUpperCase().replace(/-/g, "_");
  }

  private getEnv(envVar: string): string | undefined {
    if (typeof process !== "undefined" && process.env) {
      return process.env[envVar];
    }
    return undefined;
  }

  async get(key: string): Promise<string | undefined> {
    const envVar = this.resolveEnvVar(key);
    return this.getEnv(envVar);
  }

  async put(key: string, value: string, _options?: CredentialPutOptions): Promise<void> {
    const envVar = this.resolveEnvVar(key);
    if (typeof process !== "undefined" && process.env) {
      process.env[envVar] = value;
    }
    if (!this.keyToEnvVar.has(key)) {
      this.keyToEnvVar.set(key, envVar);
    }
  }

  async delete(key: string): Promise<boolean> {
    const envVar = this.resolveEnvVar(key);
    if (typeof process !== "undefined" && process.env && envVar in process.env) {
      delete process.env[envVar];
      return true;
    }
    return false;
  }

  async has(key: string): Promise<boolean> {
    const envVar = this.resolveEnvVar(key);
    return this.getEnv(envVar) !== undefined;
  }

  async keys(): Promise<readonly string[]> {
    const result: string[] = [];
    for (const [credKey] of this.keyToEnvVar) {
      if (await this.has(credKey)) {
        result.push(credKey);
      }
    }
    return result;
  }

  async deleteAll(): Promise<void> {
    for (const [credKey] of this.keyToEnvVar) {
      await this.delete(credKey);
    }
  }
}
