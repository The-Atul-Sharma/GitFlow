#!/usr/bin/env node
import { execFile } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import chalk from "chalk";
import yaml from "js-yaml";
import minimist from "minimist";
import { z } from "zod";

import {
  createAIProvider,
  withFallback,
  type AIOptions,
  type AIProvider,
  type ProviderName,
} from "../core/ai/index.ts";
import {
  createConfirmation,
  type ConfirmMode,
  type Confirmation,
} from "../core/confirmation/index.ts";
import {
  createGitClient,
  type GitClient,
  NotInRepoError,
} from "../core/git/index.ts";
import {
  createSecrets,
  SecretNotFoundError,
  type SecretKey,
  type Secrets,
} from "../core/secrets/index.ts";
import { createCommitGenerator } from "../modules/commitGenerator/index.ts";
import {
  createCommentFixer,
  type CommentFixerGitClient,
} from "../modules/commentFixer/index.ts";
import {
  createPrCreator,
  type PrCreatorGitClient,
} from "../modules/prCreator/index.ts";
import { createPrDescription } from "../modules/prDescription/index.ts";
import {
  createPrReviewer,
  type ReviewRule,
} from "../modules/prReviewer/index.ts";
import {
  createAzureDevOpsPlatform,
  type AzureDevOpsConfig,
} from "../platforms/azureDevops/index.ts";
import {
  createGitHubPlatform,
  parseGitHubRemote,
  type GitHubConfig,
  type GitPlatform,
} from "../platforms/github/index.ts";

const execFileAsync = promisify(execFile);

const CONFIG_FILENAME = "gpilot.config.yml";
const HOOK_PREPARE_COMMIT = "prepare-commit-msg";
const HOOK_POST_PUSH = "post-push";

const EXIT_SUCCESS = 0;
const EXIT_ERROR = 1;
const EXIT_CANCELLED = 2;

/** Confirmation modes accepted in gpilot.config.yml. */
const confirmModeValues = ["interactive", "auto", "dryrun"] as const;

const providerNameSchema = z.enum(["claude", "openai", "gemini", "ollama"]);
const platformTypeSchema = z.enum(["github", "azure-devops"]);
const confirmModeSchema = z.enum(confirmModeValues);
const severitySchema = z.enum(["blocker", "warning", "info"]);

const aiSectionSchema = z
  .object({
    provider: providerNameSchema,
    model: z
      .string()
      .min(
        1,
        'ai.model is empty. Set "ai.model" in gpilot.config.yml to a non-empty model id.',
      ),
    fallback: providerNameSchema.optional(),
  })
  .refine((ai) => ai.fallback === undefined || ai.fallback !== ai.provider, {
    message:
      "ai.fallback must be different from ai.provider. Choose another provider or remove fallback.",
    path: ["fallback"],
  });

const platformSectionSchema = z.object({
  type: platformTypeSchema,
  owner: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  org: z.string().min(1).optional(),
  project: z.string().min(1).optional(),
  repositoryId: z.string().min(1).optional(),
});

const modeSectionSchema = z.object({
  commit: confirmModeSchema,
  pr_create: confirmModeSchema,
  pr_description: confirmModeSchema,
  pr_review: confirmModeSchema,
  comment_fix: confirmModeSchema,
});

const reviewRuleSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  severity: severitySchema,
});

const reviewSectionSchema = z.object({
  rules: z.array(reviewRuleSchema),
});

const configSchema = z.object({
  ai: aiSectionSchema,
  platform: platformSectionSchema,
  mode: modeSectionSchema,
  review: reviewSectionSchema,
});

export interface gpilotConfig {
  ai: {
    provider: ProviderName;
    model: string;
    fallback?: ProviderName;
  };
  platform: {
    type: "github" | "azure-devops";
    owner?: string;
    repo?: string;
    org?: string;
    project?: string;
    repositoryId?: string;
  };
  mode: {
    commit: ConfirmMode;
    pr_create: ConfirmMode;
    pr_description: ConfirmMode;
    pr_review: ConfirmMode;
    comment_fix: ConfirmMode;
  };
  review: {
    rules: ReviewRule[];
  };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const PROVIDER_SECRET: Record<Exclude<ProviderName, "ollama">, SecretKey> = {
  claude: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

const DEFAULT_PROVIDER_MODEL: Record<ProviderName, string> = {
  claude: "claude-sonnet-4-6",
  openai: "gpt-4o",
  gemini: "gemini-2.0-flash",
  ollama: "llama3",
};

const HELP_TEXT = `gpilot — automate your git workflow with AI

Usage:
  npx gpilot <command> [options]

Commands:
  auth                       Store AI and platform credentials in the OS keychain
  install                    Install git hooks (prepare-commit-msg, post-push)
  commit [--dry-run]         Generate a Conventional Commit message for staged changes
  pr [create] [--dry-run]    Push current branch and open a PR with an AI description
  review [--pr <id>] [--json]
                             Review a PR (or local diff) and post inline comments
  fix [--pr <id>] [--comment <id>]
                             Apply AI fixes to PR review comments
  status [--json]            Show the current configuration / repo status summary

Flags:
  --version                  Print the gpilot version
  --help                     Print this help text
  --hook                     Internal: forces mode=auto (used by installed hooks)
  --dry-run                  Generate output but do not commit, push, or create PR
  --json                     Emit machine-readable JSON (status, review)

Environment:
  DEBUG=gpilot              Print full stack traces on error
`;

/**
 * Read and validate `gpilot.config.yml` from the given directory.
 *
 * @param cwd - directory to look in; defaults to `process.cwd()`
 * @returns the parsed and validated config object
 * @throws ConfigError when the file is missing, unparseable, or fails schema validation
 */
export function loadConfig(cwd?: string): gpilotConfig {
  const dir = cwd ?? process.cwd();
  const path = join(dir, CONFIG_FILENAME);

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new ConfigError(
        `No ${CONFIG_FILENAME} found at ${dir}. Run: npx gpilot init`,
      );
    }
    const reason = err instanceof Error ? err.message : String(err);
    throw new ConfigError(
      `Failed to read ${path}: ${reason}. Check the file exists and is readable.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ConfigError(
      `Failed to parse ${CONFIG_FILENAME} as YAML: ${reason}. Fix the YAML syntax and re-run.`,
    );
  }

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    const fields = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new ConfigError(
      `Invalid ${CONFIG_FILENAME}: ${fields}. Fix the listed fields and re-run.`,
    );
  }

  return result.data as gpilotConfig;
}

interface ExtendedGitClient
  extends GitClient, PrCreatorGitClient, CommentFixerGitClient {}

function createExtendedGitClient(cwd: string): ExtendedGitClient {
  const base = createGitClient(cwd);
  return {
    ...base,
    async push(branch: string): Promise<void> {
      if (!branch) {
        throw new Error(
          'push branch is empty. Pass a non-empty branch name (e.g. "feature/x").',
        );
      }
      try {
        await execFileAsync(
          "git",
          ["push", "--set-upstream", "origin", branch],
          { cwd, maxBuffer: 50 * 1024 * 1024 },
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(
          `git push origin ${branch} failed: ${reason}. Check your remote and credentials.`,
        );
      }
    },
    async stage(files: string[]): Promise<void> {
      if (files.length === 0) return;
      try {
        await execFileAsync("git", ["add", "--", ...files], {
          cwd,
          maxBuffer: 50 * 1024 * 1024,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(
          `git add ${files.join(" ")} failed: ${reason}. Verify the files exist relative to the repo root.`,
        );
      }
    },
  };
}

async function ensureAiSecret(
  config: gpilotConfig,
  secrets: Secrets,
): Promise<void> {
  const requiredProviders: ProviderName[] = [config.ai.provider];
  if (config.ai.fallback) {
    requiredProviders.push(config.ai.fallback);
  }
  for (const provider of requiredProviders) {
    if (provider === "ollama") continue;
    const key = PROVIDER_SECRET[provider];
    if (process.env[key]) continue;
    const value = await secrets.get(key);
    if (!value) {
      throw new SecretNotFoundError(key);
    }
    process.env[key] = value;
  }
}

function createConfiguredAI(config: gpilotConfig): AIProvider {
  const primary = createAIProvider({
    provider: config.ai.provider,
    model: config.ai.model,
  });
  if (!config.ai.fallback || config.ai.fallback === config.ai.provider) {
    return primary;
  }
  const fallback = createAIProvider({
    provider: config.ai.fallback,
    model: DEFAULT_PROVIDER_MODEL[config.ai.fallback],
  });
  return {
    name: primary.name,
    async complete(prompt: string, options?: AIOptions): Promise<string> {
      return withFallback(primary, fallback, prompt, options);
    },
  };
}

async function resolveGitHubConfig(
  config: gpilotConfig,
  git: GitClient,
  secrets: Secrets,
): Promise<GitHubConfig> {
  let owner = config.platform.owner;
  let repo = config.platform.repo;
  if (!owner || !repo) {
    const remoteUrl = await git.getRemoteUrl();
    const parsed = parseGitHubRemote(remoteUrl);
    owner = owner ?? parsed.owner;
    repo = repo ?? parsed.repo;
  }
  const token = await secrets.get("GITHUB_TOKEN");
  if (!token) {
    throw new SecretNotFoundError("GITHUB_TOKEN");
  }
  return { owner, repo, token };
}

async function resolveAzureDevOpsConfig(
  config: gpilotConfig,
  secrets: Secrets,
): Promise<AzureDevOpsConfig> {
  const org = config.platform.org;
  const project = config.platform.project;
  const repositoryId = config.platform.repositoryId;
  if (!org || !project || !repositoryId) {
    throw new ConfigError(
      "platform.org, platform.project, and platform.repositoryId are required for azure-devops. Set them in gpilot.config.yml.",
    );
  }
  const pat = await secrets.get("AZURE_DEVOPS_PAT");
  if (!pat) {
    throw new SecretNotFoundError("AZURE_DEVOPS_PAT");
  }
  return { org, project, repositoryId, pat };
}

async function resolvePlatform(
  config: gpilotConfig,
  git: GitClient,
  secrets: Secrets,
): Promise<GitPlatform> {
  if (config.platform.type === "github") {
    return createGitHubPlatform(
      await resolveGitHubConfig(config, git, secrets),
    );
  }
  return createAzureDevOpsPlatform(
    await resolveAzureDevOpsConfig(config, secrets),
  );
}

interface EnquirerLike {
  prompt(options: unknown): Promise<Record<string, unknown>>;
}

async function loadEnquirer(): Promise<EnquirerLike> {
  const mod = (await import("enquirer")) as
    | EnquirerLike
    | { default: EnquirerLike };
  return "default" in mod && mod.default ? mod.default : (mod as EnquirerLike);
}

interface SecretPrompt {
  key: SecretKey;
  message: string;
}

const AUTH_PROMPTS: SecretPrompt[] = [
  { key: "ANTHROPIC_API_KEY", message: "Anthropic API key (sk-ant-...)" },
  { key: "OPENAI_API_KEY", message: "OpenAI API key (sk-...)" },
  { key: "GEMINI_API_KEY", message: "Gemini API key" },
  { key: "GITHUB_TOKEN", message: "GitHub token (ghp_...)" },
  { key: "AZURE_DEVOPS_PAT", message: "Azure DevOps PAT" },
];

async function runAuth(secrets: Secrets): Promise<void> {
  const enquirer = await loadEnquirer();
  for (const { key, message } of AUTH_PROMPTS) {
    const response = await enquirer.prompt({
      type: "password",
      name: "value",
      message: `${message} (leave blank to skip)`,
    });
    const value =
      typeof response["value"] === "string" ? response["value"] : "";
    if (value.trim().length > 0) {
      await secrets.set(key, value.trim());
    }
  }
  process.stdout.write(`${chalk.green("✓")} Secrets stored in OS keychain\n`);
}

async function findGitDir(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--git-dir"], {
      cwd,
    });
    const gitDir = stdout.trim();
    return gitDir.startsWith("/") ? gitDir : join(cwd, gitDir);
  } catch {
    throw new NotInRepoError();
  }
}

async function runInstall(cwd: string): Promise<void> {
  const gitDir = await findGitDir(cwd);
  const hooksDir = join(gitDir, "hooks");
  mkdirSync(hooksDir, { recursive: true });

  const hooks: { name: string; body: string }[] = [
    {
      name: HOOK_PREPARE_COMMIT,
      body: "#!/bin/sh\nnpx gpilot commit --hook\n",
    },
    {
      name: HOOK_POST_PUSH,
      body: "#!/bin/sh\nnpx gpilot pr --hook\n",
    },
  ];

  for (const hook of hooks) {
    const path = join(hooksDir, hook.name);
    writeFileSync(path, hook.body, "utf8");
    chmodSync(path, 0o755);
  }

  process.stdout.write(
    `${chalk.green("✓")} Installed git hooks: ${hooks.map((h) => h.name).join(", ")}\n`,
  );
}

function pickMode(configured: ConfirmMode, hookFlag: boolean): ConfirmMode {
  return hookFlag ? "auto" : configured;
}

function createSilentConfirmation(): Confirmation {
  return {
    async ask() {
      return { action: "no" };
    },
  };
}

async function runCommit(
  config: gpilotConfig,
  hookFlag: boolean,
  cwd: string,
  dryRun: boolean,
): Promise<void> {
  const secrets = createSecrets();
  await ensureAiSecret(config, secrets);
  const ai = createConfiguredAI(config);
  const git = createExtendedGitClient(cwd);
  const confirmation = dryRun
    ? createSilentConfirmation()
    : createConfirmation();

  const mode: ConfirmMode = dryRun
    ? "dryrun"
    : pickMode(config.mode.commit, hookFlag);

  const generator = createCommitGenerator({
    ai,
    git,
    confirmation,
    mode,
    shouldCreateCommit: !hookFlag && !dryRun,
  });

  const result = await generator.run();

  if (dryRun) {
    process.stdout.write(
      `${JSON.stringify({ message: result.message ?? "" })}\n`,
    );
    return;
  }

  if (result.status === "cancelled") {
    process.exitCode = EXIT_CANCELLED;
  }
}

async function runPr(
  config: gpilotConfig,
  hookFlag: boolean,
  cwd: string,
  dryRun: boolean,
): Promise<void> {
  const secrets = createSecrets();
  await ensureAiSecret(config, secrets);
  const ai = createConfiguredAI(config);
  const git = createExtendedGitClient(cwd);
  const confirmation = createConfirmation();

  if (dryRun) {
    const prDescription = createPrDescription({
      ai,
      git,
      confirmation: createSilentConfirmation(),
      mode: "dryrun",
    });
    const result = await prDescription.run();
    process.stdout.write(
      `${JSON.stringify({ title: result.title ?? "", description: result.body ?? "" })}\n`,
    );
    return;
  }

  const platform = await resolvePlatform(config, git, secrets);

  const prDescription = createPrDescription({
    ai,
    git,
    confirmation,
    mode: pickMode(config.mode.pr_description, hookFlag),
  });

  const creator = createPrCreator({
    platform,
    prDescription,
    git,
    confirmation,
    mode: pickMode(config.mode.pr_create, hookFlag),
  });

  const result = await creator.run();
  if (result.status === "cancelled") {
    process.exitCode = EXIT_CANCELLED;
  } else if (result.status === "created" && result.pr) {
    process.stdout.write(`${chalk.green("✓")} Opened PR: ${result.pr.url}\n`);
  }
}

async function runReview(
  config: gpilotConfig,
  prId: string | undefined,
  hookFlag: boolean,
  cwd: string,
  jsonOutput: boolean,
): Promise<void> {
  const secrets = createSecrets();
  await ensureAiSecret(config, secrets);
  const ai = createConfiguredAI(config);
  const git = createExtendedGitClient(cwd);
  const confirmation = jsonOutput
    ? createSilentConfirmation()
    : createConfirmation();
  const platform = await resolvePlatform(config, git, secrets);

  const reviewer = createPrReviewer({
    ai,
    git,
    platform,
    confirmation,
    mode: jsonOutput ? "dryrun" : pickMode(config.mode.pr_review, hookFlag),
    rules: config.review.rules,
    ...(prId ? { prId } : {}),
  });

  const result = await reviewer.run();

  if (jsonOutput) {
    process.stdout.write(
      `${JSON.stringify({ issues: result.issues ?? [] })}\n`,
    );
    return;
  }

  if (result.status === "cancelled") {
    process.exitCode = EXIT_CANCELLED;
  }
}

async function runFix(
  config: gpilotConfig,
  prId: string,
  commentId: string | undefined,
  hookFlag: boolean,
  cwd: string,
): Promise<void> {
  const secrets = createSecrets();
  await ensureAiSecret(config, secrets);
  const ai = createConfiguredAI(config);
  const git = createExtendedGitClient(cwd);
  const confirmation = createConfirmation();
  const platform = await resolvePlatform(config, git, secrets);

  const fixer = createCommentFixer({
    ai,
    git,
    platform,
    confirmation,
    mode: pickMode(config.mode.comment_fix, hookFlag),
    prId,
    ...(commentId ? { commentId } : {}),
  });

  const result = await fixer.run();
  if (result.status === "cancelled") {
    process.exitCode = EXIT_CANCELLED;
  }
}

async function detectBranchPushed(
  cwd: string,
  branch: string,
): Promise<boolean> {
  if (!branch) return false;
  try {
    await execFileAsync(
      "git",
      ["rev-parse", "--verify", `refs/remotes/origin/${branch}`],
      { cwd, maxBuffer: 50 * 1024 * 1024 },
    );
    return true;
  } catch {
    return false;
  }
}

async function detectHasOpenPR(
  config: gpilotConfig,
  git: GitClient,
  secrets: Secrets,
  branch: string,
): Promise<boolean> {
  if (!branch || config.platform.type !== "github") return false;
  try {
    const { owner, repo, token } = await resolveGitHubConfig(
      config,
      git,
      secrets,
    );
    const { Octokit } = await import("@octokit/rest");
    const octokit = new Octokit({ auth: token });
    const response = await octokit.pulls.list({
      owner,
      repo,
      head: `${owner}:${branch}`,
      state: "open",
      per_page: 1,
    });
    return response.data.length > 0;
  } catch {
    return false;
  }
}

async function detectHasCommit(cwd: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd,
      maxBuffer: 50 * 1024 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

async function listWorkingTreeFiles(cwd: string): Promise<
  Array<{
    status: string;
    path: string;
    staged: boolean;
    unstaged: boolean;
  }>
> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["status", "--short", "--untracked-files=all"],
      { cwd, maxBuffer: 50 * 1024 * 1024 },
    );
    return stdout
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 3)
      .map((line) => {
        const indexStatus = line[0] ?? " ";
        const worktreeStatus = line[1] ?? " ";
        return {
          status: line.slice(0, 2).trim() || "?",
          path: line.slice(3).trim(),
          staged: indexStatus !== " " && indexStatus !== "?",
          unstaged: worktreeStatus !== " " || line.startsWith("??"),
        };
      });
  } catch {
    return [];
  }
}

async function runStatus(
  config: gpilotConfig,
  cwd: string,
  jsonOutput: boolean,
): Promise<void> {
  const secrets = createSecrets();
  const git = createExtendedGitClient(cwd);

  const platformLabel =
    config.platform.type === "github"
      ? `github (${config.platform.owner ?? "?"}/${config.platform.repo ?? "?"})`
      : `azure-devops (${config.platform.org ?? "?"}/${config.platform.project ?? "?"}/${config.platform.repositoryId ?? "?"})`;

  const aiKey =
    config.ai.provider === "ollama"
      ? null
      : PROVIDER_SECRET[config.ai.provider];
  const platformKey: SecretKey =
    config.platform.type === "github" ? "GITHUB_TOKEN" : "AZURE_DEVOPS_PAT";

  const aiSecretPresent = aiKey ? await secrets.has(aiKey) : true;
  const platformSecretPresent = await secrets.has(platformKey);

  let hooksInstalled = false;
  try {
    const gitDir = await findGitDir(cwd);
    const prepareHook = join(gitDir, "hooks", HOOK_PREPARE_COMMIT);
    readFileSync(prepareHook, "utf8");
    hooksInstalled = true;
  } catch {
    hooksInstalled = false;
  }

  const currentBranch = await git.getCurrentBranch().catch(() => "");
  const hasCommit = await detectHasCommit(cwd);
  const isBranchPushed = await detectBranchPushed(cwd, currentBranch);
  const hasOpenPR = isBranchPushed
    ? await detectHasOpenPR(config, git, secrets, currentBranch)
    : false;
  const changedFiles = await listWorkingTreeFiles(cwd);

  if (jsonOutput) {
    process.stdout.write(
      `${JSON.stringify({
        ai: {
          provider: config.ai.provider,
          model: config.ai.model,
          configured: aiSecretPresent,
        },
        platform: {
          type: config.platform.type,
          configured: platformSecretPresent,
        },
        branch: currentBranch || null,
        hasCommit,
        isBranchPushed,
        hasOpenPR,
        changedFiles,
        hooksInstalled,
      })}\n`,
    );
    return;
  }

  const lines = [
    `${chalk.bold("gpilot status")}`,
    `  AI:        ${config.ai.provider} (${config.ai.model})${config.ai.fallback ? ` → fallback ${config.ai.fallback}` : ""}`,
    `  Platform:  ${platformLabel}`,
    `  Branch:    ${currentBranch || "(detached)"} ${isBranchPushed ? chalk.green("(pushed)") : chalk.yellow("(local only)")}`,
    `  PR:        ${hasOpenPR ? chalk.green("open") : chalk.dim("none")}`,
    `  Modes:     commit=${config.mode.commit}, pr_create=${config.mode.pr_create}, pr_description=${config.mode.pr_description}, pr_review=${config.mode.pr_review}, comment_fix=${config.mode.comment_fix}`,
    `  Secrets:   ${aiKey ?? "ollama (none)"}=${aiSecretPresent ? "set" : chalk.yellow("missing")}, ${platformKey}=${platformSecretPresent ? "set" : chalk.yellow("missing")}`,
    `  Hooks:     ${hooksInstalled ? chalk.green("installed") : chalk.yellow("not installed")}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "..", "package.json"),
    join(here, "..", "..", "..", "package.json"),
  ];
  for (const candidate of candidates) {
    try {
      const raw = readFileSync(candidate, "utf8");
      const parsed = JSON.parse(raw) as { version?: string };
      if (parsed.version) return parsed.version;
    } catch {
      continue;
    }
  }
  return "0.0.0";
}

function reportError(err: unknown): void {
  const debug = process.env["DEBUG"] === "gpilot";
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${chalk.red("error")}: ${message}\n`);
  if (debug && err instanceof Error && err.stack) {
    process.stderr.write(`${err.stack}\n`);
  }
}

const argvSchema = z.array(z.string());

/**
 * gpilot CLI entry point.
 *
 * Parses `argv` (without the leading `node` and script path), routes to the
 * matching command, and translates module results into process exit codes:
 * 0 on success, 1 on error, 2 on user cancellation. All errors are caught
 * here; only `DEBUG=gpilot` causes stack traces to be printed.
 *
 * @param argv - raw arguments, e.g. `process.argv.slice(2)`
 */
export async function main(argv: string[]): Promise<void> {
  argvSchema.parse(argv);

  const args = minimist(argv, {
    boolean: ["version", "help", "hook", "dry-run", "json"],
    string: ["pr", "comment"],
    alias: { v: "version", h: "help" },
  });

  if (args["version"]) {
    process.stdout.write(`${readPackageVersion()}\n`);
    process.exitCode = EXIT_SUCCESS;
    return;
  }

  if (args["help"]) {
    process.stdout.write(HELP_TEXT);
    process.exitCode = EXIT_SUCCESS;
    return;
  }

  const command = args._[0];
  const cwd = process.cwd();
  const hookFlag = Boolean(args["hook"]);
  const dryRun = Boolean(args["dry-run"]);
  const jsonOutput = Boolean(args["json"]);

  try {
    switch (command) {
      case "auth": {
        await runAuth(createSecrets());
        return;
      }
      case "install": {
        await runInstall(cwd);
        return;
      }
      case "commit": {
        await runCommit(loadConfig(cwd), hookFlag, cwd, dryRun);
        return;
      }
      case "pr": {
        await runPr(loadConfig(cwd), hookFlag, cwd, dryRun);
        return;
      }
      case "review": {
        const prId =
          typeof args["pr"] === "string" && args["pr"].length > 0
            ? args["pr"]
            : undefined;
        await runReview(loadConfig(cwd), prId, hookFlag, cwd, jsonOutput);
        return;
      }
      case "fix": {
        const prId = typeof args["pr"] === "string" ? args["pr"] : "";
        if (!prId) {
          throw new Error(
            "--pr <id> is required for fix. Pass the PR id, e.g. npx gpilot fix --pr 142.",
          );
        }
        const commentId =
          typeof args["comment"] === "string" && args["comment"].length > 0
            ? args["comment"]
            : undefined;
        await runFix(loadConfig(cwd), prId, commentId, hookFlag, cwd);
        return;
      }
      case "status": {
        await runStatus(loadConfig(cwd), cwd, jsonOutput);
        return;
      }
      default: {
        process.stderr.write(
          command
            ? `${chalk.red("error")}: unknown command "${command}"\n\n`
            : `${chalk.red("error")}: no command provided\n\n`,
        );
        process.stderr.write(HELP_TEXT);
        process.exitCode = EXIT_CANCELLED;
        return;
      }
    }
  } catch (err) {
    reportError(err);
    process.exitCode = EXIT_ERROR;
  }
}

const invokedDirectly = (() => {
  try {
    const argvPath = process.argv[1];
    if (argvPath === undefined) return false;
    return (
      realpathSync(fileURLToPath(import.meta.url)) === realpathSync(argvPath)
    );
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  await main(process.argv.slice(2));
}
