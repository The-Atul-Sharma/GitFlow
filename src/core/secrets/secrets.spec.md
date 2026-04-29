# Module: secrets

## Purpose

Securely store and retrieve API keys and tokens needed by gpilot.
Supports OS keychain (preferred) and environment variables (fallback).

## Public API

```ts
export interface Secrets {
  set(key: SecretKey, value: string): Promise<void>;
  get(key: SecretKey): Promise<string | null>;
  delete(key: SecretKey): Promise<void>;
  has(key: SecretKey): Promise<boolean>;
}

export type SecretKey =
  | "ANTHROPIC_API_KEY"
  | "OPENAI_API_KEY"
  | "GEMINI_API_KEY"
  | "GITHUB_TOKEN"
  | "AZURE_DEVOPS_PAT"
  | "GITLAB_TOKEN";

export function createSecrets(): Secrets;
```

## Storage backends

1. OS keychain via keytar (macOS Keychain, Windows Credential Manager, Linux libsecret)
2. Environment variables as fallback when keytar unavailable

## Resolution priority

When calling get():

1. Check OS keychain first
2. If not found, check process.env[key]
3. If still not found, return null

## Rules

- Service name in keychain is "gpilot"
- Never log secret values, only key names
- Never write secrets to disk in plain text
- delete() must remove from keychain only, not env vars
- has() returns true if value exists in either location

## Error cases

- keytar fails to load → fall back to env-only mode silently
- Missing required secret → throw SecretNotFoundError with message
  "Secret <KEY> not found. Run: npx gpilot auth"

## Tests required

- get returns value from keychain when present
- get falls back to process.env when keychain empty
- get returns null when neither has the value
- set writes to keychain
- delete removes from keychain
- has returns true if either keychain or env has it
- Logs never contain secret values
- Throws helpful error when keytar unavailable
