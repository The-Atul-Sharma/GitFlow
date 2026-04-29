import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SecretKey, Secrets } from "../index.ts";

const SERVICE_NAME = "gpilot";

interface KeytarMock {
  setPassword: ReturnType<typeof vi.fn>;
  getPassword: ReturnType<typeof vi.fn>;
  deletePassword: ReturnType<typeof vi.fn>;
}

function makeKeytarMock(): KeytarMock {
  return {
    setPassword: vi.fn().mockResolvedValue(undefined),
    getPassword: vi.fn().mockResolvedValue(null),
    deletePassword: vi.fn().mockResolvedValue(true),
  };
}

const ALL_KEYS: readonly SecretKey[] = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GITHUB_TOKEN",
  "AZURE_DEVOPS_PAT",
  "GITLAB_TOKEN",
];

async function importWithKeytar(
  keytar: KeytarMock,
): Promise<typeof import("../index.ts")> {
  vi.doMock("keytar", () => keytar);
  return import("../index.ts");
}

async function importWithBrokenKeytar(): Promise<typeof import("../index.ts")> {
  vi.doMock("keytar", () => {
    throw new Error("libsecret not installed");
  });
  return import("../index.ts");
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const key of ALL_KEYS) {
    delete process.env[key];
  }
});

afterEach(() => {
  vi.doUnmock("keytar");
  process.env = { ...ORIGINAL_ENV };
});

describe("createSecrets", () => {
  it("returns a Secrets object exposing set/get/delete/has", async () => {
    const keytar = makeKeytarMock();
    const { createSecrets } = await importWithKeytar(keytar);
    const secrets: Secrets = createSecrets();
    expect(typeof secrets.set).toBe("function");
    expect(typeof secrets.get).toBe("function");
    expect(typeof secrets.delete).toBe("function");
    expect(typeof secrets.has).toBe("function");
  });
});

describe("get", () => {
  it("returns the value from the keychain when present", async () => {
    const keytar = makeKeytarMock();
    keytar.getPassword.mockResolvedValueOnce("sk-from-keychain");
    const { createSecrets } = await importWithKeytar(keytar);

    const result = await createSecrets().get("ANTHROPIC_API_KEY");

    expect(result).toBe("sk-from-keychain");
    expect(keytar.getPassword).toHaveBeenCalledWith(
      SERVICE_NAME,
      "ANTHROPIC_API_KEY",
    );
  });

  it("falls back to process.env when the keychain is empty", async () => {
    const keytar = makeKeytarMock();
    keytar.getPassword.mockResolvedValue(null);
    process.env.OPENAI_API_KEY = "sk-from-env";
    const { createSecrets } = await importWithKeytar(keytar);

    const result = await createSecrets().get("OPENAI_API_KEY");

    expect(result).toBe("sk-from-env");
    expect(keytar.getPassword).toHaveBeenCalledWith(
      SERVICE_NAME,
      "OPENAI_API_KEY",
    );
  });

  it("prefers the keychain over the environment when both have a value", async () => {
    const keytar = makeKeytarMock();
    keytar.getPassword.mockResolvedValueOnce("keychain-wins");
    process.env.GITHUB_TOKEN = "env-loses";
    const { createSecrets } = await importWithKeytar(keytar);

    const result = await createSecrets().get("GITHUB_TOKEN");

    expect(result).toBe("keychain-wins");
  });

  it("returns null when neither the keychain nor the environment has the value", async () => {
    const keytar = makeKeytarMock();
    const { createSecrets } = await importWithKeytar(keytar);

    const result = await createSecrets().get("GITLAB_TOKEN");

    expect(result).toBeNull();
  });

  it("rejects unknown keys with a fix-suggesting zod error", async () => {
    const keytar = makeKeytarMock();
    const { createSecrets } = await importWithKeytar(keytar);

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createSecrets().get("NOT_A_KEY" as any),
    ).rejects.toThrow();
  });
});

describe("set", () => {
  it("writes the value to the keychain under the gpilot service", async () => {
    const keytar = makeKeytarMock();
    const { createSecrets } = await importWithKeytar(keytar);

    await createSecrets().set("ANTHROPIC_API_KEY", "sk-new-secret");

    expect(keytar.setPassword).toHaveBeenCalledTimes(1);
    expect(keytar.setPassword).toHaveBeenCalledWith(
      SERVICE_NAME,
      "ANTHROPIC_API_KEY",
      "sk-new-secret",
    );
  });

  it("rejects an empty value with a fix-suggesting message", async () => {
    const keytar = makeKeytarMock();
    const { createSecrets } = await importWithKeytar(keytar);

    await expect(createSecrets().set("OPENAI_API_KEY", "")).rejects.toThrow(
      /empty/i,
    );
    expect(keytar.setPassword).not.toHaveBeenCalled();
  });
});

describe("delete", () => {
  it("removes the value from the keychain", async () => {
    const keytar = makeKeytarMock();
    const { createSecrets } = await importWithKeytar(keytar);

    await createSecrets().delete("GEMINI_API_KEY");

    expect(keytar.deletePassword).toHaveBeenCalledWith(
      SERVICE_NAME,
      "GEMINI_API_KEY",
    );
  });

  it("does not touch process.env even when the env has the same key", async () => {
    const keytar = makeKeytarMock();
    process.env.AZURE_DEVOPS_PAT = "env-pat-stays";
    const { createSecrets } = await importWithKeytar(keytar);

    await createSecrets().delete("AZURE_DEVOPS_PAT");

    expect(process.env.AZURE_DEVOPS_PAT).toBe("env-pat-stays");
  });
});

describe("has", () => {
  it("returns true when the keychain holds the value", async () => {
    const keytar = makeKeytarMock();
    keytar.getPassword.mockResolvedValueOnce("present");
    const { createSecrets } = await importWithKeytar(keytar);

    expect(await createSecrets().has("ANTHROPIC_API_KEY")).toBe(true);
  });

  it("returns true when only the environment holds the value", async () => {
    const keytar = makeKeytarMock();
    keytar.getPassword.mockResolvedValue(null);
    process.env.GITLAB_TOKEN = "env-only";
    const { createSecrets } = await importWithKeytar(keytar);

    expect(await createSecrets().has("GITLAB_TOKEN")).toBe(true);
  });

  it("returns false when neither has the value", async () => {
    const keytar = makeKeytarMock();
    const { createSecrets } = await importWithKeytar(keytar);

    expect(await createSecrets().has("GITHUB_TOKEN")).toBe(false);
  });
});

describe("keytar load failure", () => {
  it("falls back to env-only mode silently when keytar fails to load", async () => {
    process.env.ANTHROPIC_API_KEY = "env-fallback";
    const { createSecrets } = await importWithBrokenKeytar();
    const secrets = createSecrets();

    await expect(secrets.get("ANTHROPIC_API_KEY")).resolves.toBe(
      "env-fallback",
    );
    await expect(secrets.has("ANTHROPIC_API_KEY")).resolves.toBe(true);
    await expect(secrets.get("OPENAI_API_KEY")).resolves.toBeNull();
    await expect(secrets.has("OPENAI_API_KEY")).resolves.toBe(false);
  });

  it("makes set/delete no-ops when keytar fails to load (no throw)", async () => {
    const { createSecrets } = await importWithBrokenKeytar();
    const secrets = createSecrets();

    await expect(
      secrets.set("GITHUB_TOKEN", "whatever"),
    ).resolves.toBeUndefined();
    await expect(secrets.delete("GITHUB_TOKEN")).resolves.toBeUndefined();
  });
});

describe("logging", () => {
  it("never includes the secret value in any error or console output", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const SECRET = "sk-must-never-leak-" + Math.random().toString(36).slice(2);
    const keytar = makeKeytarMock();
    keytar.setPassword.mockRejectedValueOnce(new Error("keychain locked"));
    keytar.getPassword.mockResolvedValueOnce(SECRET);
    const { createSecrets } = await importWithKeytar(keytar);
    const secrets = createSecrets();

    // set failure surfaces an error — verify the secret value isn't in the message
    let setError: unknown;
    try {
      await secrets.set("ANTHROPIC_API_KEY", SECRET);
    } catch (err) {
      setError = err;
    }
    expect(setError).toBeInstanceOf(Error);
    expect((setError as Error).message).not.toContain(SECRET);

    // get returns the value — but logs must remain clean
    await secrets.get("ANTHROPIC_API_KEY");

    for (const spy of [consoleLog, consoleError, consoleWarn]) {
      for (const call of spy.mock.calls) {
        for (const arg of call) {
          expect(String(arg)).not.toContain(SECRET);
        }
      }
    }

    consoleLog.mockRestore();
    consoleError.mockRestore();
    consoleWarn.mockRestore();
  });
});

describe("SecretNotFoundError", () => {
  it("formats the helpful auth-prompt message and carries the key", async () => {
    const keytar = makeKeytarMock();
    const { SecretNotFoundError } = await importWithKeytar(keytar);

    const err = new SecretNotFoundError("ANTHROPIC_API_KEY");

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("SecretNotFoundError");
    expect(err.key).toBe("ANTHROPIC_API_KEY");
    expect(err.message).toBe(
      "Secret ANTHROPIC_API_KEY not found. Run: npx gpilot auth",
    );
  });
});
