import { z } from "zod";

export type SecretKey =
  | "ANTHROPIC_API_KEY"
  | "OPENAI_API_KEY"
  | "GEMINI_API_KEY"
  | "GITHUB_TOKEN"
  | "AZURE_DEVOPS_PAT"
  | "GITLAB_TOKEN";

export interface Secrets {
  set(key: SecretKey, value: string): Promise<void>;
  get(key: SecretKey): Promise<string | null>;
  delete(key: SecretKey): Promise<void>;
  has(key: SecretKey): Promise<boolean>;
}

export class SecretNotFoundError extends Error {
  readonly key: SecretKey;

  constructor(key: SecretKey) {
    super(`Secret ${key} not found. Run: npx gpilot auth`);
    this.name = "SecretNotFoundError";
    this.key = key;
  }
}

const SERVICE_NAME = "gpilot";

const secretKeySchema = z.enum([
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GITHUB_TOKEN",
  "AZURE_DEVOPS_PAT",
  "GITLAB_TOKEN",
]);

const secretValueSchema = z
  .string()
  .min(
    1,
    "Secret value is empty. Pass the API key or token string itself, not an empty string.",
  );

interface KeytarLike {
  setPassword(
    service: string,
    account: string,
    password: string,
  ): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

let keytarPromise: Promise<KeytarLike | null> | null = null;

async function loadKeytar(): Promise<KeytarLike | null> {
  if (keytarPromise) return keytarPromise;
  keytarPromise = (async () => {
    try {
      const mod = (await import("keytar")) as
        | KeytarLike
        | { default: KeytarLike };
      return "default" in mod && mod.default
        ? mod.default
        : (mod as KeytarLike);
    } catch {
      return null;
    }
  })();
  return keytarPromise;
}

/**
 * Create a Secrets store backed by the OS keychain with environment-variable fallback.
 *
 * Reads prefer the OS keychain (via keytar); if a secret is absent there, process.env
 * is consulted next. Writes and deletes target the keychain only — environment
 * variables are never modified. If keytar fails to load (e.g. missing libsecret on
 * Linux), the store silently degrades to an env-only read mode and writes become no-ops.
 *
 * @returns a Secrets implementation usable across the app
 */
export function createSecrets(): Secrets {
  return {
    async set(key, value) {
      const validKey = secretKeySchema.parse(key);
      const validValue = secretValueSchema.parse(value);
      const keytar = await loadKeytar();
      if (!keytar) return;
      await keytar.setPassword(SERVICE_NAME, validKey, validValue);
    },

    async get(key) {
      const validKey = secretKeySchema.parse(key);
      const keytar = await loadKeytar();
      if (keytar) {
        const fromKeychain = await keytar.getPassword(SERVICE_NAME, validKey);
        if (fromKeychain) return fromKeychain;
      }
      const fromEnv = process.env[validKey];
      if (fromEnv) return fromEnv;
      return null;
    },

    async delete(key) {
      const validKey = secretKeySchema.parse(key);
      const keytar = await loadKeytar();
      if (!keytar) return;
      await keytar.deletePassword(SERVICE_NAME, validKey);
    },

    async has(key) {
      const validKey = secretKeySchema.parse(key);
      const keytar = await loadKeytar();
      if (keytar) {
        const fromKeychain = await keytar.getPassword(SERVICE_NAME, validKey);
        if (fromKeychain) return true;
      }
      return Boolean(process.env[validKey]);
    },
  };
}
