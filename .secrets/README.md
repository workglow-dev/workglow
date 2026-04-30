# Encrypted credentials

Provider API keys (Anthropic, OpenAI, Gemini, HuggingFace) are stored
**encrypted** as one JSON file per key in `./credentials/`. Each file contains
AES-256-GCM ciphertext plus IV and metadata, derived from a single master
passphrase. The ciphertext files are safe to commit and are required for CI.

The only sensitive value is the passphrase, exported as
`WORKGLOW_SECRETS_PASSPHRASE`. Plaintext API keys never touch disk and never
land in shell history or `.env` files.

## Local setup

1. Pick a strong passphrase and store it in your OS keyring (macOS Keychain,
   `secret-tool` on Linux, Windows Credential Manager). A simple shell wrapper:

       export WORKGLOW_SECRETS_PASSPHRASE="$(security find-generic-password -s workglow-secrets -w)"   # macOS
       export WORKGLOW_SECRETS_PASSPHRASE="$(secret-tool lookup service workglow-secrets)"             # Linux

2. Add credentials. You can import keys you already have exported in the
   current shell, or set them one-by-one (interactive prompt hides input):

       bun scripts/credentials.ts import-env
       # or
       bun scripts/credentials.ts set anthropic-api-key

3. Run tests as usual. `vitest.setup.ts` and `bunfig.toml`'s test preload will
   decrypt the store and hydrate `process.env.ANTHROPIC_API_KEY` (etc.) for the
   duration of the test process only.

       bun run test

If `WORKGLOW_SECRETS_PASSPHRASE` is unset, the encrypted layer stays locked and
integration tests skip via their existing `!!process.env.*_API_KEY` guards.
Unit tests run unaffected.

## CI setup

1. Configure a single repository secret named `WORKGLOW_SECRETS_PASSPHRASE`.
2. Commit ciphertext from `.secrets/credentials/*.json` to the repo.
3. Export the secret in the test job:

       env:
         WORKGLOW_SECRETS_PASSPHRASE: ${{ secrets.WORKGLOW_SECRETS_PASSPHRASE }}

That replaces having to configure `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.
as separate CI secrets.

## Known credential keys

| Credential key      | Env var hydrated     |
| ------------------- | -------------------- |
| `anthropic-api-key` | `ANTHROPIC_API_KEY`  |
| `openai-api-key`    | `OPENAI_API_KEY`     |
| `google-api-key`    | `GOOGLE_API_KEY`     |
| `gemini-api-key`    | `GEMINI_API_KEY`     |
| `hf-token`          | `HF_TOKEN`           |

To add another, edit `CREDENTIAL_TO_ENV` in `scripts/lib/test-credentials.ts`.

## Rotating the passphrase

    bun scripts/credentials.ts rotate <new-passphrase>

This decrypts every credential under the old passphrase, re-encrypts under the
new one, and writes the result back to `.secrets/credentials/`. Update the
keychain/CI secret to the new value, commit the changed ciphertext files.
