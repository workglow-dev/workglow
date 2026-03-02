/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared MCP authentication type definitions and JSON Schema.
 */

import type { DataPortSchemaObject } from "../json-schema/DataPortSchema.js";

/**
 * Supported MCP authentication types.
 */
export const mcpAuthTypes = [
  "none",
  "bearer",
  "client_credentials",
  "private_key_jwt",
  "static_private_key_jwt",
  "authorization_code",
] as const;

export type McpAuthType = (typeof mcpAuthTypes)[number];

// ── Discriminated union on `type` ──────────────────────────────────────

export interface McpAuthNone {
  readonly type: "none";
}

export interface McpAuthBearer {
  readonly type: "bearer";
  /** Static token or credential-store key (format: "credential"). */
  readonly token: string;
}

export interface McpAuthClientCredentials {
  readonly type: "client_credentials";
  readonly client_id: string;
  /** Client secret or credential-store key (format: "credential"). */
  readonly client_secret: string;
  readonly client_name?: string;
  readonly scope?: string;
}

export interface McpAuthPrivateKeyJwt {
  readonly type: "private_key_jwt";
  readonly client_id: string;
  /** PEM / JWK private key or credential-store key (format: "credential"). */
  readonly private_key: string;
  readonly algorithm: string;
  readonly client_name?: string;
  readonly jwt_lifetime_seconds?: number;
  readonly scope?: string;
}

export interface McpAuthStaticPrivateKeyJwt {
  readonly type: "static_private_key_jwt";
  readonly client_id: string;
  /** Pre-built JWT assertion or credential-store key (format: "credential"). */
  readonly jwt_bearer_assertion: string;
  readonly client_name?: string;
  readonly scope?: string;
}

export interface McpAuthAuthorizationCode {
  readonly type: "authorization_code";
  readonly client_id: string;
  readonly client_secret?: string;
  readonly redirect_url: string;
  readonly scope?: string;
}

export type McpAuthConfig =
  | McpAuthNone
  | McpAuthBearer
  | McpAuthClientCredentials
  | McpAuthPrivateKeyJwt
  | McpAuthStaticPrivateKeyJwt
  | McpAuthAuthorizationCode;

// ── JSON Schema properties for auth config ─────────────────────────────

export const mcpAuthConfigSchema = {
  auth_type: {
    type: "string",
    enum: mcpAuthTypes,
    title: "Auth Type",
    description: "Authentication method for connecting to the MCP server",
    default: "none",
  },
  auth_token: {
    type: "string",
    format: "credential",
    title: "Bearer Token",
    description: "Static bearer token or API key (for bearer auth)",
  },
  auth_client_id: {
    type: "string",
    title: "Client ID",
    description: "OAuth client ID (for OAuth auth types)",
  },
  auth_client_secret: {
    type: "string",
    format: "credential",
    title: "Client Secret",
    description: "OAuth client secret (for client_credentials auth)",
  },
  auth_private_key: {
    type: "string",
    format: "credential",
    title: "Private Key",
    description: "PEM or JWK private key (for private_key_jwt auth)",
  },
  auth_algorithm: {
    type: "string",
    title: "Algorithm",
    description: "JWT signing algorithm, e.g. RS256, ES256 (for private_key_jwt auth)",
  },
  auth_jwt_bearer_assertion: {
    type: "string",
    format: "credential",
    title: "JWT Assertion",
    description: "Pre-built JWT assertion (for static_private_key_jwt auth)",
  },
  auth_redirect_url: {
    type: "string",
    format: "uri",
    title: "Redirect URL",
    description: "OAuth redirect URL (for authorization_code auth)",
  },
  auth_scope: {
    type: "string",
    title: "Scope",
    description: "OAuth scope (space-separated)",
  },
  auth_client_name: {
    type: "string",
    title: "Client Name",
    description: "Optional OAuth client display name",
  },
  auth_jwt_lifetime_seconds: {
    type: "number",
    title: "JWT Lifetime",
    description: "JWT lifetime in seconds (default: 300)",
    minimum: 1,
  },
} as const satisfies DataPortSchemaObject["properties"];

/**
 * Constructs a typed McpAuthConfig from flat schema properties.
 * Used by `createMcpClient()` to normalize the config.
 */
export function buildAuthConfig(flat: Record<string, unknown>): McpAuthConfig | undefined {
  const authType = flat.auth_type as McpAuthType | undefined;
  if (!authType || authType === "none") return undefined;

  switch (authType) {
    case "bearer":
      return {
        type: "bearer",
        token: flat.auth_token as string,
      };
    case "client_credentials":
      return {
        type: "client_credentials",
        client_id: flat.auth_client_id as string,
        client_secret: flat.auth_client_secret as string,
        client_name: flat.auth_client_name as string | undefined,
        scope: flat.auth_scope as string | undefined,
      };
    case "private_key_jwt":
      return {
        type: "private_key_jwt",
        client_id: flat.auth_client_id as string,
        private_key: flat.auth_private_key as string,
        algorithm: flat.auth_algorithm as string,
        client_name: flat.auth_client_name as string | undefined,
        jwt_lifetime_seconds: flat.auth_jwt_lifetime_seconds as number | undefined,
        scope: flat.auth_scope as string | undefined,
      };
    case "static_private_key_jwt":
      return {
        type: "static_private_key_jwt",
        client_id: flat.auth_client_id as string,
        jwt_bearer_assertion: flat.auth_jwt_bearer_assertion as string,
        client_name: flat.auth_client_name as string | undefined,
        scope: flat.auth_scope as string | undefined,
      };
    case "authorization_code":
      return {
        type: "authorization_code",
        client_id: flat.auth_client_id as string,
        client_secret: flat.auth_client_secret as string | undefined,
        redirect_url: flat.auth_redirect_url as string,
        scope: flat.auth_scope as string | undefined,
      };
    default:
      return undefined;
  }
}
