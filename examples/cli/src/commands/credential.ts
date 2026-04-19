/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CREDENTIAL_PROVIDER_NONE,
  CredentialPutInputSchema,
  getGlobalCredentialStore,
} from "@workglow/util";
import type { DataPortSchemaObject } from "@workglow/util/schema";
import type { Command } from "commander";
import {
  applySchemaDefaults,
  generateSchemaHelpText,
  parseDynamicFlags,
  resolveInput,
  validateInput,
} from "../input";
import { promptEditableInput } from "../input/prompt";
import { ensureCredentialStoreUnlocked } from "../keyring";

const CredentialSchema = CredentialPutInputSchema as DataPortSchemaObject;

export function registerCredentialCommand(program: Command): void {
  const credential = program.command("credential").description("Manage encrypted credentials");

  const add = credential
    .command("add")
    .argument("[key]", "optional credential key; pre-fills Key and focuses Value in the form")
    .description("Add or update an encrypted credential")
    .allowUnknownOption()
    .allowExcessArguments(true)
    .helpOption(false)
    .option("--input-json <json>", "Input as JSON string")
    .option("--input-json-file <path>", "Input from JSON file")
    .option("--dry-run", "Validate input without saving")
    .option("--help", "Show help")
    .action(
      async (cliKey: string | undefined, opts: Record<string, string | boolean | undefined>) => {
        if (opts.help) {
          add.outputHelp();
          console.log("\nInput flags (from credential schema):");
          console.log(generateSchemaHelpText(CredentialSchema));
          process.exit(0);
        }

        await ensureCredentialStoreUnlocked();

        const dynamicFlags = parseDynamicFlags(process.argv, CredentialSchema);
        let input = await resolveInput({
          inputJson: opts.inputJson as string | undefined,
          inputJsonFile: opts.inputJsonFile as string | undefined,
          dynamicFlags,
          schema: CredentialSchema,
        });

        input = applySchemaDefaults(input, CredentialSchema);

        const trimmedPositional = cliKey !== undefined ? String(cliKey).trim() : "";
        let usedPositionalKey = false;
        if (trimmedPositional !== "") {
          const existing = input.key;
          const hasExplicitKey =
            existing !== undefined && existing !== null && String(existing).trim() !== "";
          if (!hasExplicitKey) {
            input = { ...input, key: trimmedPositional };
            usedPositionalKey = true;
          }
        }

        if (process.stdin.isTTY) {
          input = await promptEditableInput(input, CredentialSchema, {
            initialFocusedFieldKey: usedPositionalKey ? "value" : undefined,
          });
        }

        const validation = validateInput(input, CredentialSchema);
        if (!validation.valid) {
          console.error("Input validation failed:");
          for (const err of validation.errors) {
            console.error(`  - ${err}`);
          }
          process.exit(1);
        }

        const key = String(input.key ?? "").trim();
        const value = String(input.value ?? "");
        const labelRaw = input.label;
        const providerRaw = input.provider;
        const label =
          typeof labelRaw === "string" && labelRaw.trim() !== "" ? labelRaw.trim() : undefined;
        const providerTrim =
          typeof providerRaw === "string" && providerRaw.trim() !== ""
            ? providerRaw.trim()
            : undefined;
        const provider =
          providerTrim !== undefined && providerTrim !== CREDENTIAL_PROVIDER_NONE
            ? providerTrim
            : undefined;

        if (!key || !value) {
          console.error("Key and value are required and must be non-empty.");
          process.exit(1);
        }

        if (opts.dryRun) {
          console.log(JSON.stringify({ key, value: "(redacted)", label, provider }, null, 2));
          process.exit(0);
        }

        const store = getGlobalCredentialStore();
        await store.put(key, value, {
          provider,
          label,
        });
        console.log(`Credential "${key}" saved.`);
      }
    );

  credential
    .command("list")
    .description("List all stored credential keys")
    .action(async () => {
      await ensureCredentialStoreUnlocked();

      const store = getGlobalCredentialStore();
      const keys = await store.keys();
      if (keys.length === 0) {
        console.log("No credentials stored.");
        return;
      }
      for (const key of keys) {
        console.log(key);
      }
    });

  credential
    .command("get")
    .argument("<key>", "credential key to retrieve")
    .description("Retrieve and display a credential value")
    .action(async (key: string) => {
      await ensureCredentialStoreUnlocked();

      const store = getGlobalCredentialStore();
      const value = await store.get(key);
      if (value === undefined) {
        console.error(`Credential "${key}" not found.`);
        process.exit(1);
      }

      if (process.stdout.isTTY) {
        console.warn("Warning: credential value will be displayed in plaintext.");
      }
      console.log(value);
    });

  credential
    .command("delete")
    .argument("<key>", "credential key to delete")
    .description("Delete a stored credential")
    .action(async (key: string) => {
      await ensureCredentialStoreUnlocked();

      const store = getGlobalCredentialStore();
      const deleted = await store.delete(key);
      if (deleted) {
        console.log(`Credential "${key}" deleted.`);
      } else {
        console.error(`Credential "${key}" not found.`);
        process.exit(1);
      }
    });
}
