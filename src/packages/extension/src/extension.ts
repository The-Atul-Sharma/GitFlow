import * as vscode from "vscode";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dump as dumpYaml, load as parseYaml } from "js-yaml";

const execFileAsync = promisify(execFile);

export type ReviewSeverity = "blocker" | "warning" | "info";

export type gpilotMode = "gpilot" | "native";

export interface ReviewIssue {
  id: string;
  file: string;
  line: number;
  severity: ReviewSeverity;
  comment: string;
  suggestedFix?: string;
}

export interface ModelOption {
  label: string;
  detail: string;
  provider: string;
  model: string;
}

export interface RepoStatus {
  branch: string | null;
  hasCommit: boolean;
  isBranchPushed: boolean;
  hasOpenPR: boolean;
  changedFiles: Array<{
    status: string;
    path: string;
    staged: boolean;
    unstaged: boolean;
  }>;
}

export interface ExtensionMessageFromWebview {
  type:
    | "switchModel"
    | "setupKeys"
    | "showPanel"
    | "requestState"
    | "generateCommit"
    | "commitMessage"
    | "generatePr"
    | "createPr"
    | "pushBranch"
    | "runReview"
    | "publishReview"
    | "openPr"
    | "previewFix"
    | "applyFix"
    | "openWorkingTree"
    | "openFileDiff"
    | "closeFileDiff"
    | "stageFile"
    | "unstageFile"
    | "setMode"
    | "refreshStatus"
    | "pickSpecFile"
    | "generateSpec"
    | "openSpec";
  provider?: string;
  model?: string;
  message?: string;
  title?: string;
  description?: string;
  mode?: gpilotMode;
  path?: string;
  issueId?: string;
  sections?: string[];
  staged?: boolean;
  status?: string;
}

export interface ExtensionMessageToWebview {
  type:
    | "configUpdate"
    | "modelOptionsUpdate"
    | "setupStatus"
    | "commandRunning"
    | "commandDone"
    | "commandFailed"
    | "commitDraft"
    | "prDraft"
    | "reviewResult"
    | "repoStatus"
    | "modeUpdate"
    | "specFilePicked"
    | "specGenerated"
    | "openDiffsUpdate";
  provider?: string;
  model?: string;
  models?: Array<{ label: string; provider: string; model: string }>;
  command?: string;
  error?: string;
  aiConfigured?: boolean;
  platformConfigured?: boolean;
  ready?: boolean;
  message?: string;
  title?: string;
  description?: string;
  issues?: ReviewIssue[];
  status?: RepoStatus;
  mode?: gpilotMode;
  path?: string;
  preview?: string;
  paths?: string[];
}

export class ExtensionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtensionError";
  }
}

export const VIEW_ID = "gpilot.panel";

export const FIRST_LAUNCH_STATE_KEY = "gpilot.firstLaunchComplete";
export const MODE_STATE_KEY = "gpilot.mode";

export type SecretKey =
  | "ANTHROPIC_API_KEY"
  | "OPENAI_API_KEY"
  | "GEMINI_API_KEY"
  | "GITHUB_TOKEN"
  | "AZURE_DEVOPS_PAT"
  | "GITLAB_TOKEN";

interface SecretDescriptor {
  key: SecretKey;
  label: string;
  detail: string;
}

export const SECRET_DESCRIPTORS: ReadonlyArray<SecretDescriptor> = [
  {
    key: "ANTHROPIC_API_KEY",
    label: "Anthropic API key",
    detail: "Required for Claude models",
  },
  {
    key: "OPENAI_API_KEY",
    label: "OpenAI API key",
    detail: "Required for GPT models",
  },
  {
    key: "GEMINI_API_KEY",
    label: "Gemini API key",
    detail: "Required for Gemini models",
  },
  {
    key: "GITHUB_TOKEN",
    label: "GitHub token",
    detail: "Required to create / review GitHub PRs",
  },
  {
    key: "AZURE_DEVOPS_PAT",
    label: "Azure DevOps PAT",
    detail: "Required for Azure DevOps PRs",
  },
  {
    key: "GITLAB_TOKEN",
    label: "GitLab token",
    detail: "Required for GitLab MRs",
  },
];

export const MODEL_OPTIONS: ReadonlyArray<ModelOption> = [
  {
    label: "Claude Sonnet 4.6",
    detail: "Fast and smart — recommended",
    provider: "claude",
    model: "claude-sonnet-4-6",
  },
  {
    label: "Claude Opus 4.7",
    detail: "Most capable, slower",
    provider: "claude",
    model: "claude-opus-4-7",
  },
  {
    label: "GPT-4o",
    detail: "OpenAI — requires OPENAI_API_KEY",
    provider: "openai",
    model: "gpt-4o",
  },
  {
    label: "Gemini 2.5 Pro",
    detail: "Google — requires GEMINI_API_KEY",
    provider: "gemini",
    model: "gemini-2.5-pro",
  },
  {
    label: "Gemini 2.0 Flash",
    detail: "Google fast model — requires GEMINI_API_KEY",
    provider: "gemini",
    model: "gemini-2.0-flash",
  },
];

interface OllamaTagsResponse {
  models?: Array<{
    name?: string;
    model?: string;
  }>;
}

const OLLAMA_TAGS_ENDPOINT = "http://localhost:11434/api/tags";

async function isOllamaReachable(): Promise<boolean> {
  // Race fetch against an explicit timeout. Some failure modes (DNS hang,
  // half-open socket) don't trigger AbortController fast enough on their own,
  // which would leave the footer stuck on "Ollama running" after the daemon dies.
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), 1000);
    fetch(OLLAMA_TAGS_ENDPOINT)
      .then((response) => {
        clearTimeout(timer);
        finish(response.ok);
      })
      .catch(() => {
        clearTimeout(timer);
        finish(false);
      });
  });
}

async function fetchLocalOllamaModelOptions(): Promise<ModelOption[]> {
  try {
    const response = await fetch(OLLAMA_TAGS_ENDPOINT);
    if (!response.ok) return [];
    const data = (await response.json()) as OllamaTagsResponse;
    const installed = (data.models ?? [])
      .map((entry) => entry.name ?? entry.model ?? "")
      .filter((name) => name.length > 0);
    const unique = Array.from(new Set(installed)).sort();
    return unique.map((model) => ({
      label: `Ollama: ${model}`,
      detail: "Installed locally in Ollama",
      provider: "ollama",
      model,
    }));
  } catch {
    return [];
  }
}

const TERMINAL_NAME = "gpilot";

const SECRETS_SERVICE_NAME = "gpilot";

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

export async function hasSecret(key: SecretKey): Promise<boolean> {
  const keytar = await loadKeytar();
  if (!keytar) return false;
  const value = await keytar.getPassword(SECRETS_SERVICE_NAME, key);
  return Boolean(value);
}

export async function setSecret(key: SecretKey, value: string): Promise<void> {
  const keytar = await loadKeytar();
  if (!keytar) {
    throw new ExtensionError(
      "Cannot save API key: native keychain module (keytar) failed to load. On Linux, install libsecret-1-dev and reload VS Code.",
    );
  }
  await keytar.setPassword(SECRETS_SERVICE_NAME, key, value);
}

export async function deleteSecret(key: SecretKey): Promise<void> {
  const keytar = await loadKeytar();
  if (!keytar) return;
  await keytar.deletePassword(SECRETS_SERVICE_NAME, key);
}

export async function promptForSecret(
  descriptor: SecretDescriptor,
): Promise<boolean> {
  const existed = await hasSecret(descriptor.key);
  const value = await vscode.window.showInputBox({
    prompt: `${descriptor.label} — ${descriptor.detail}`,
    placeHolder: existed
      ? "Leave empty to keep current value"
      : "Paste the key here",
    password: true,
    ignoreFocusOut: true,
  });
  if (value === undefined) return false;
  if (value === "") return existed;
  await setSecret(descriptor.key, value);
  await vscode.window.showInformationMessage(
    `gpilot: Saved ${descriptor.label}.`,
  );
  return true;
}

export async function manageApiKeys(
  onUpdated?: () => Promise<void> | void,
): Promise<void> {
  while (true) {
    const items: Array<
      vscode.QuickPickItem & { descriptor?: SecretDescriptor; action?: "clear" }
    > = [];
    for (const d of SECRET_DESCRIPTORS) {
      const set = await hasSecret(d.key);
      items.push({
        label: `${set ? "$(check)" : "$(circle-large-outline)"} ${d.label}`,
        description: set ? "set" : "not set",
        detail: d.detail,
        descriptor: d,
      });
    }
    items.push({ label: "$(trash) Clear a saved key…", action: "clear" });

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Select an API key to set or update",
      ignoreFocusOut: true,
    });
    if (!picked) return;

    if (picked.action === "clear") {
      const changed = await clearSecretFlow();
      if (changed) {
        await onUpdated?.();
      }
      continue;
    }
    if (picked.descriptor) {
      const changed = await promptForSecret(picked.descriptor);
      if (changed) {
        await onUpdated?.();
      }
    }
  }
}

async function clearSecretFlow(): Promise<boolean> {
  const items: Array<vscode.QuickPickItem & { descriptor: SecretDescriptor }> =
    [];
  for (const d of SECRET_DESCRIPTORS) {
    if (await hasSecret(d.key)) {
      items.push({ label: d.label, detail: d.detail, descriptor: d });
    }
  }
  if (items.length === 0) {
    await vscode.window.showInformationMessage(
      "gpilot: No saved keys to clear.",
    );
    return false;
  }
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a key to remove from the keychain",
    ignoreFocusOut: true,
  });
  if (!picked) return false;
  await deleteSecret(picked.descriptor.key);
  await vscode.window.showInformationMessage(
    `gpilot: Cleared ${picked.descriptor.label}.`,
  );
  return true;
}

export async function runFirstLaunchSetupIfNeeded(
  context: vscode.ExtensionContext,
): Promise<void> {
  const done = context.globalState.get<boolean>(FIRST_LAUNCH_STATE_KEY);
  if (done) return;
  const mode = context.globalState.get<gpilotMode>(MODE_STATE_KEY) ?? "gpilot";
  if (mode === "native") {
    await context.globalState.update(FIRST_LAUNCH_STATE_KEY, true);
    return;
  }
  const aiConfigured =
    (await hasSecret("ANTHROPIC_API_KEY")) ||
    (await hasSecret("OPENAI_API_KEY")) ||
    (await hasSecret("GEMINI_API_KEY"));
  const platformConfigured =
    (await hasSecret("GITHUB_TOKEN")) ||
    (await hasSecret("AZURE_DEVOPS_PAT")) ||
    (await hasSecret("GITLAB_TOKEN"));
  const root = workspaceRoot();
  const current = root ? await readCurrentModel(root) : null;
  const provider = current?.provider ?? "claude";
  const ready =
    provider === "ollama"
      ? platformConfigured
      : aiConfigured && platformConfigured;
  if (ready) {
    await context.globalState.update(FIRST_LAUNCH_STATE_KEY, true);
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    "gpilot needs AI and platform keys before using the panel. Set them now?",
    "Set up keys",
    "Later",
  );
  if (choice === "Set up keys") {
    await manageApiKeys();
    const aiConfiguredAfterSetup =
      (await hasSecret("ANTHROPIC_API_KEY")) ||
      (await hasSecret("OPENAI_API_KEY")) ||
      (await hasSecret("GEMINI_API_KEY"));
    const platformConfiguredAfterSetup =
      (await hasSecret("GITHUB_TOKEN")) ||
      (await hasSecret("AZURE_DEVOPS_PAT")) ||
      (await hasSecret("GITLAB_TOKEN"));
    const currentAfterSetup = root ? await readCurrentModel(root) : null;
    const providerAfterSetup = currentAfterSetup?.provider ?? provider;
    const readyAfterSetup =
      providerAfterSetup === "ollama"
        ? platformConfiguredAfterSetup
        : aiConfiguredAfterSetup && platformConfiguredAfterSetup;
    if (readyAfterSetup) {
      await context.globalState.update(FIRST_LAUNCH_STATE_KEY, true);
    }
    return;
  }
}

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Run a gpilot CLI command and capture its stdout. Used for dry-run /
 * JSON commands where the extension needs the data inline rather than
 * showing it to the user in a terminal.
 */
async function execgpilot(args: string[]): Promise<string> {
  const root = workspaceRoot();
  if (!root) {
    throw new ExtensionError(
      "Open a workspace folder before running gpilot commands.",
    );
  }
  const env = { ...process.env };
  for (const key of [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "GITHUB_TOKEN",
    "AZURE_DEVOPS_PAT",
    "GITLAB_TOKEN",
  ] as const) {
    if (!env[key]) {
      const fromKeychain = await readSecret(key);
      if (fromKeychain) env[key] = fromKeychain;
    }
  }
  try {
    const { stdout, stderr } = await execFileAsync("npx", ["gpilot", ...args], {
      cwd: root,
      maxBuffer: 50 * 1024 * 1024,
      env,
    });
    if (!stdout.trim()) {
      throw new ExtensionError(
        `gpilot ${args.join(" ")} returned no output. ${stderr.trim() || "Check that the gpilot CLI is installed and the AI provider key is configured."}`,
      );
    }
    return stdout;
  } catch (error) {
    if (error instanceof ExtensionError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new ExtensionError(
      `gpilot ${args.join(" ")} failed: ${message}. Verify the CLI is installed (npx gpilot --version) and your API keys are saved via Manage Keys.`,
    );
  }
}

async function readSecret(key: SecretKey): Promise<string | null> {
  const keytar = await loadKeytar();
  if (!keytar) return null;
  return keytar.getPassword(SECRETS_SERVICE_NAME, key);
}

function findOrCreateTerminal(): vscode.Terminal {
  const root = workspaceRoot();
  return root
    ? vscode.window.createTerminal({ name: TERMINAL_NAME, cwd: root })
    : vscode.window.createTerminal(TERMINAL_NAME);
}

/** Open a terminal and run a gpilot CLI command interactively. */
export async function runCommand(
  command: string,
  args: string[] = [],
): Promise<void> {
  const terminal = findOrCreateTerminal();
  terminal.sendText(
    `npx gpilot ${command}${args.length ? " " + args.join(" ") : ""}`,
  );
}

async function runShellCommand(command: string): Promise<void> {
  const terminal = findOrCreateTerminal();
  terminal.sendText(command);
}

function workspaceFileUri(path: string): vscode.Uri {
  const root = workspaceRoot();
  if (!root) {
    throw new ExtensionError("Open a workspace folder first.");
  }
  return vscode.Uri.file(join(root, path));
}

function gitUriForRef(path: string, ref: "HEAD" | "~"): vscode.Uri {
  // The git extension exposes file contents at a ref via the `git:` scheme.
  // Encoding matches what the built-in git extension emits internally.
  const fileUri = workspaceFileUri(path);
  return fileUri.with({
    scheme: "git",
    query: JSON.stringify({ path: fileUri.fsPath, ref }),
  });
}

interface FileChangeShape {
  isUntracked: boolean; // ??
  addedAtIndex: boolean; // first char A
  addedAtWorktree: boolean; // second char A
  deletedAtIndex: boolean; // first char D
  deletedAtWorktree: boolean; // second char D
  renamedAtIndex: boolean; // first char R
}

function shapeFromStatus(status: string): FileChangeShape {
  const trimmed = status ?? "";
  const indexChar = trimmed[0] ?? " ";
  const worktreeChar = trimmed[1] ?? " ";
  const isUntracked = trimmed === "??" || trimmed === "?";
  return {
    isUntracked,
    addedAtIndex: indexChar === "A",
    addedAtWorktree: worktreeChar === "A" || isUntracked,
    deletedAtIndex: indexChar === "D",
    deletedAtWorktree: worktreeChar === "D",
    renamedAtIndex: indexChar === "R",
  };
}

async function openSingleFile(uri: vscode.Uri): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
}

async function openFileDiff(
  path: string,
  staged: boolean,
  status: string,
): Promise<void> {
  if (!path || !path.trim()) {
    throw new ExtensionError("openFileDiff requires a file path.");
  }
  const fileUri = workspaceFileUri(path);
  const fileName = path.split(/[\\/]/).pop() ?? path;
  const shape = shapeFromStatus(status);
  let opened = false;

  // Pick the right open strategy based on the file's actual change shape.
  // `vscode.diff` fails with "file not found" if either side doesn't exist
  // at the requested ref, so for new / deleted files we either skip the
  // diff or substitute an empty buffer.
  try {
    if (staged) {
      if (shape.addedAtIndex || shape.renamedAtIndex) {
        // Newly added (or renamed) at index — no HEAD version exists. Just
        // open the indexed copy as a normal document.
        await openSingleFile(gitUriForRef(path, "~"));
      } else if (shape.deletedAtIndex) {
        // Deleted at index — show what was there at HEAD.
        await openSingleFile(gitUriForRef(path, "HEAD"));
      } else {
        // Modified at index — HEAD ↔ index diff.
        await vscode.commands.executeCommand(
          "vscode.diff",
          gitUriForRef(path, "HEAD"),
          gitUriForRef(path, "~"),
          `${fileName} (Index)`,
          { preview: false },
        );
      }
    } else {
      if (shape.isUntracked) {
        // Untracked — no git version of this file at all. Open it directly.
        await openSingleFile(fileUri);
      } else if (shape.addedAtWorktree && !shape.addedAtIndex) {
        // Added but not yet indexed — same situation, open directly.
        await openSingleFile(fileUri);
      } else if (shape.deletedAtWorktree) {
        // Deleted in working tree — show what HEAD had.
        await openSingleFile(gitUriForRef(path, "HEAD"));
      } else {
        // Modified in working tree — HEAD ↔ working diff.
        await vscode.commands.executeCommand(
          "vscode.diff",
          gitUriForRef(path, "HEAD"),
          fileUri,
          `${fileName} (Working Tree)`,
          { preview: false },
        );
      }
    }
    opened = true;
  } catch {
    // Last-ditch fallback: try to open the working file. If even that
    // fails, surface the original error to the panel banner.
    try {
      await openSingleFile(fileUri);
      opened = true;
    } catch (innerError) {
      throw new ExtensionError(
        `Could not open ${path}: ${innerError instanceof Error ? innerError.message : String(innerError)}`,
      );
    }
  }
  if (opened) {
    try {
      // Pin the editor so subsequent clicks open new tabs instead of
      // replacing a preview tab.
      await vscode.commands.executeCommand("workbench.action.keepEditor");
    } catch {
      /* keepEditor isn't always available; non-fatal. */
    }
  }
}

async function stageFile(path: string): Promise<void> {
  if (!path || !path.trim()) {
    throw new ExtensionError("stageFile requires a file path.");
  }
  const root = workspaceRoot();
  if (!root) {
    throw new ExtensionError("Open a workspace folder before staging.");
  }
  await execFileAsync("git", ["add", "--", path], {
    cwd: root,
    maxBuffer: 50 * 1024 * 1024,
  });
}

async function pickRepoFile(): Promise<string | null> {
  const root = workspaceRoot();
  if (!root) {
    throw new ExtensionError("Open a workspace folder before picking a file.");
  }
  const items = await vscode.workspace.findFiles(
    "**/*",
    "{**/node_modules/**,**/.git/**,**/dist/**,**/out/**}",
    1000,
  );
  if (items.length === 0) {
    await vscode.window.showInformationMessage(
      "gpilot: No files found in workspace.",
    );
    return null;
  }
  const picks: vscode.QuickPickItem[] = items.map((uri) => ({
    label: vscode.workspace.asRelativePath(uri),
  }));
  const picked = await vscode.window.showQuickPick(picks, {
    placeHolder: "Pick a file to generate spec.md for",
    matchOnDescription: true,
  });
  return picked?.label ?? null;
}

interface ParsedExport {
  signature: string;
  doc: string | null;
  kind: "function" | "class" | "const" | "interface" | "type" | "enum";
  name: string;
}

function parseExports(source: string): ParsedExport[] {
  const lines = source.split("\n");
  const exports: ParsedExport[] = [];
  let pendingDoc: string | null = null;
  let pendingDocLines: string[] = [];
  let inDoc = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (inDoc) {
      pendingDocLines.push(trimmed.replace(/^\* ?/, "").replace(/^\*\/$/, ""));
      if (trimmed.endsWith("*/")) {
        inDoc = false;
        pendingDoc = pendingDocLines
          .filter((l) => l !== "*" && l !== "")
          .join(" ")
          .replace(/\s+/g, " ")
          .replace(/\*\/$/, "")
          .trim();
        pendingDocLines = [];
      }
      continue;
    }
    if (trimmed.startsWith("/**")) {
      inDoc = !trimmed.endsWith("*/");
      pendingDocLines = [
        trimmed
          .replace(/^\/\*\*\s?/, "")
          .replace(/\*\/$/, "")
          .trim(),
      ];
      if (!inDoc) {
        pendingDoc = pendingDocLines.join(" ").trim();
        pendingDocLines = [];
      }
      continue;
    }
    const exportMatch = line.match(
      /^\s*export\s+(?:default\s+)?(?:async\s+)?(function|class|const|let|interface|type|enum)\s+([A-Za-z0-9_$]+)/,
    );
    if (exportMatch) {
      const kind = exportMatch[1] as ParsedExport["kind"];
      const name = exportMatch[2] ?? "";
      let signature = trimmed.replace(/\{.*$/, "").replace(/=>.*$/, "").trim();
      if (kind === "interface" || kind === "type" || kind === "enum") {
        signature = `${kind} ${name}`;
      }
      exports.push({ signature, doc: pendingDoc, kind, name });
      pendingDoc = null;
    } else if (
      trimmed &&
      !trimmed.startsWith("//") &&
      !trimmed.startsWith("import")
    ) {
      pendingDoc = null;
    }
  }
  return exports;
}

function summarizeFile(source: string, fileName: string): string {
  const banner = source
    .split("\n")
    .slice(0, 30)
    .map((l) => l.trim())
    .find((l) => l.startsWith("/**") || l.startsWith("//"));
  if (banner) {
    return banner.replace(/^\/\*\*?|^\/\/|\*\/$/g, "").trim();
  }
  const exports = parseExports(source);
  if (exports.length === 0) {
    return `Internal module (\`${fileName}\`) with no exported surface.`;
  }
  const kinds = new Set(exports.map((e) => e.kind));
  const kindList = Array.from(kinds).join(", ");
  return `Module \`${fileName}\` exports ${exports.length} symbol${exports.length === 1 ? "" : "s"} (${kindList}).`;
}

function inferUsage(exports: ParsedExport[], baseName: string): string {
  if (exports.length === 0) return "";
  const importNames = exports
    .filter((e) => e.kind !== "type" && e.kind !== "interface")
    .slice(0, 3)
    .map((e) => e.name);
  const typeImports = exports
    .filter((e) => e.kind === "type" || e.kind === "interface")
    .slice(0, 2)
    .map((e) => e.name);
  const importLine =
    importNames.length > 0
      ? `import { ${importNames.join(", ")} } from "./${baseName.split("/").pop() ?? baseName}";`
      : `import "./${baseName.split("/").pop() ?? baseName}";`;
  const typeLine =
    typeImports.length > 0
      ? `import type { ${typeImports.join(", ")} } from "./${baseName.split("/").pop() ?? baseName}";`
      : "";
  return [importLine, typeLine].filter(Boolean).join("\n");
}

function inferEdges(source: string, exports: ParsedExport[]): string {
  const errorNames = Array.from(
    source.matchAll(/throw\s+new\s+([A-Za-z0-9_]+Error)\s*\(/g),
  ).map((m) => m[1] ?? "");
  const uniqueErrors = Array.from(new Set(errorNames));
  const asyncCount = exports.filter((e) =>
    /\basync\b/.test(e.signature),
  ).length;
  const lines: string[] = [];
  if (uniqueErrors.length > 0) {
    lines.push(`Throws: ${uniqueErrors.map((n) => `\`${n}\``).join(", ")}.`);
  }
  if (asyncCount > 0) {
    lines.push(
      `Async surface: ${asyncCount} of ${exports.length} exports return Promises — callers must await and handle rejection.`,
    );
  }
  const guardCount = (source.match(/^\s*(?:if|switch)\s*\(/gm) ?? []).length;
  if (guardCount > 0) {
    lines.push(
      `Contains ${guardCount} guard branch${guardCount === 1 ? "" : "es"} for input validation and control flow.`,
    );
  }
  if (lines.length === 0) {
    return "No explicit error throws or async boundaries detected — failures propagate from upstream calls.";
  }
  return lines.map((l) => `- ${l}`).join("\n");
}

interface AICallResult {
  text: string;
  source: "anthropic" | "openai" | "gemini" | "ollama";
}

async function callConfiguredAi(prompt: string): Promise<AICallResult | null> {
  const root = workspaceRoot();
  if (!root) return null;
  const current = await readCurrentModel(root);
  const provider = current?.provider ?? "claude";
  const model = current?.model ?? "claude-sonnet-4-6";
  try {
    if (provider === "claude") {
      const key = await readSecret("ANTHROPIC_API_KEY");
      if (!key) return null;
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!response.ok) {
        throw new ExtensionError(
          `Anthropic API error ${response.status}: ${await response.text()}`,
        );
      }
      const data = (await response.json()) as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const text = (data.content ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("");
      return { text, source: "anthropic" };
    }
    if (provider === "openai") {
      const key = await readSecret("OPENAI_API_KEY");
      if (!key) return null;
      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 2048,
          }),
        },
      );
      if (!response.ok) {
        throw new ExtensionError(
          `OpenAI API error ${response.status}: ${await response.text()}`,
        );
      }
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data.choices?.[0]?.message?.content ?? "";
      return { text, source: "openai" };
    }
    if (provider === "gemini") {
      const key = await readSecret("GEMINI_API_KEY");
      if (!key) return null;
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
          }),
        },
      );
      if (!response.ok) {
        throw new ExtensionError(
          `Gemini API error ${response.status}: ${await response.text()}`,
        );
      }
      const data = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text =
        data.candidates?.[0]?.content?.parts
          ?.map((p) => p.text ?? "")
          .join("") ?? "";
      return { text, source: "gemini" };
    }
    if (provider === "ollama") {
      const response = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, prompt, stream: false }),
      });
      if (!response.ok) {
        throw new ExtensionError(
          `Ollama API error ${response.status}: ${await response.text()}`,
        );
      }
      const data = (await response.json()) as { response?: string };
      return { text: data.response ?? "", source: "ollama" };
    }
  } catch (error) {
    if (error instanceof ExtensionError) throw error;
    throw new ExtensionError(
      `AI call failed for provider "${provider}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return null;
}

function buildSpecPrompt(
  fileName: string,
  relativePath: string,
  source: string,
  sections: string[],
  exports: ParsedExport[],
): string {
  const wantsPurpose = sections.includes("purpose");
  const wantsApi = sections.includes("api");
  const wantsUsage = sections.includes("usage");
  const wantsEdges = sections.includes("edges");
  const exportSummary =
    exports.length === 0
      ? "(no top-level exports detected)"
      : exports.map((e) => `- ${e.kind} ${e.name}`).join("\n");
  return [
    `You are writing a precise specification document for a single source file.`,
    `Use Markdown. Do not invent behavior the source does not show. Do not add TODO placeholders.`,
    `Read the source carefully and describe what is actually there.`,
    ``,
    `File: ${relativePath}`,
    ``,
    `Detected exports:`,
    exportSummary,
    ``,
    `Required sections (omit any not listed):`,
    wantsPurpose
      ? `- ## Purpose — what this file is responsible for, in 2-4 sentences.`
      : "",
    wantsApi
      ? `- ## API Surface — for each export: a level-3 heading with backticks around the name, then a short description of what it does and (for functions) its parameters and return type. Include a ts code fence with the signature.`
      : "",
    wantsUsage
      ? `- ## Usage — a small ts code fence showing a realistic call site using the actual export names.`
      : "",
    wantsEdges
      ? `- ## Edge cases & errors — list the failure modes you can see in the code (thrown errors, validation, async rejection, etc.). Be specific to this file.`
      : "",
    ``,
    `Begin the document with a level-1 heading: \`# ${fileName}\`.`,
    `Then a one-line italic blockquote summary on the next line.`,
    ``,
    `Source code:`,
    "```",
    source,
    "```",
    ``,
    `Return only the Markdown document — no preface, no code fence around the whole thing.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildHeuristicSpec(
  fileName: string,
  relativePath: string,
  source: string,
  sections: string[],
  exports: ParsedExport[],
): string {
  const lineCount = source.split("\n").length;
  const lines: string[] = [`# ${fileName}`, ""];
  lines.push(`> ${summarizeFile(source, fileName)}`, "");
  lines.push(
    `Source: \`${relativePath}\` (${lineCount} lines, ${exports.length} exports)`,
    "",
  );
  if (sections.includes("purpose")) {
    lines.push("## Purpose", "", summarizeFile(source, fileName), "");
  }
  if (sections.includes("api")) {
    lines.push("## API Surface", "");
    if (exports.length === 0) {
      lines.push(`_No top-level exports in \`${relativePath}\`._`, "");
    } else {
      for (const ex of exports) {
        lines.push(`### \`${ex.name}\``, "");
        if (ex.doc) lines.push(ex.doc, "");
        lines.push("```ts", ex.signature, "```", "");
      }
    }
  }
  if (sections.includes("usage")) {
    const baseName = relativePath.replace(/\.[^./]+$/, "");
    const usage = inferUsage(exports, baseName);
    lines.push("## Usage", "");
    if (usage) lines.push("```ts", usage, "```", "");
    else lines.push("Imported for side effects only.", "");
  }
  if (sections.includes("edges")) {
    lines.push("## Edge cases & errors", "", inferEdges(source, exports), "");
  }
  return lines.join("\n");
}

async function generateSpecForFile(
  relativePath: string,
  sections: string[],
): Promise<{ path: string; preview: string }> {
  const root = workspaceRoot();
  if (!root) {
    throw new ExtensionError(
      "Open a workspace folder before generating a spec.",
    );
  }
  const sourceUri = workspaceFileUri(relativePath);
  const sourceContents = await readFile(sourceUri.fsPath, "utf8");
  const baseName = relativePath.replace(/\.[^./]+$/, "");
  const specRelative = `${baseName}.spec.md`;
  const specUri = workspaceFileUri(specRelative);
  const fileName = relativePath.split("/").pop() ?? relativePath;
  const exports = parseExports(sourceContents);

  let body: string;
  const aiResult = await callConfiguredAi(
    buildSpecPrompt(fileName, relativePath, sourceContents, sections, exports),
  );
  if (aiResult && aiResult.text.trim()) {
    body = aiResult.text.trim();
  } else {
    body = buildHeuristicSpec(
      fileName,
      relativePath,
      sourceContents,
      sections,
      exports,
    );
  }
  await writeFile(specUri.fsPath, body, "utf8");
  return { path: specRelative, preview: body };
}

async function unstageFile(path: string): Promise<void> {
  if (!path || !path.trim()) {
    throw new ExtensionError("unstageFile requires a file path.");
  }
  const root = workspaceRoot();
  if (!root) {
    throw new ExtensionError("Open a workspace folder before unstaging.");
  }
  await execFileAsync("git", ["reset", "HEAD", "--", path], {
    cwd: root,
    maxBuffer: 50 * 1024 * 1024,
  });
}

const commitDryRunSchema = z.object({ message: z.string() });
const prDryRunSchema = z.object({
  title: z.string(),
  description: z.string(),
});
const reviewIssueSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().nonnegative(),
  severity: z.enum(["blocker", "warning", "info"]),
  comment: z.string().min(1),
  suggestedFix: z.string().nullable().optional(),
});
const reviewJsonSchema = z.object({
  issues: z.array(reviewIssueSchema),
});
const statusJsonSchema = z.object({
  branch: z.string().nullable(),
  hasCommit: z.boolean(),
  isBranchPushed: z.boolean(),
  hasOpenPR: z.boolean(),
  changedFiles: z.array(
    z.object({
      status: z.string().min(1),
      path: z.string().min(1),
      staged: z.boolean().default(false),
      unstaged: z.boolean().default(false),
    }),
  ),
});

function lastJsonLine(stdout: string): string {
  const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
  return lines[lines.length - 1] ?? "";
}

export async function generateCommitMessage(): Promise<string> {
  const stdout = await execgpilot(["commit", "--dry-run"]);
  const parsed = JSON.parse(lastJsonLine(stdout));
  const result = commitDryRunSchema.parse(parsed);
  return result.message;
}

export async function commitWithMessage(message: string): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    throw new ExtensionError("Open a workspace folder before committing.");
  }
  const trimmed = message.trim();
  if (!trimmed) {
    throw new ExtensionError("Commit message is empty.");
  }
  // Reject obviously malformed drafts (e.g., a header that ended with `{`
  // because the model returned half a JSON object). The webview can show
  // this banner so the user knows to regenerate or edit.
  const header = trimmed.split("\n", 1)[0] ?? "";
  if (/[{[]\s*$/.test(header) || header.length < 5) {
    throw new ExtensionError(
      `Commit message looks malformed ("${header}"). Edit the textarea or regenerate before committing.`,
    );
  }
  await execFileAsync("git", ["commit", "-m", trimmed], {
    cwd: root,
    maxBuffer: 50 * 1024 * 1024,
  });
}

export async function generatePrDraft(): Promise<{
  title: string;
  description: string;
}> {
  const stdout = await execgpilot(["pr", "create", "--dry-run"]);
  const parsed = JSON.parse(lastJsonLine(stdout));
  return prDryRunSchema.parse(parsed);
}

export async function pushAndCreatePr(
  title: string,
  description: string,
): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    throw new ExtensionError("Open a workspace folder before creating a PR.");
  }
  const escapedTitle = title.replace(/"/g, '\\"');
  const escapedBody = description.replace(/"/g, '\\"');
  await runShellCommand(
    `gh pr create --title "${escapedTitle}" --body "${escapedBody}" --fill-first`,
  );
}

export async function fetchReview(): Promise<ReviewIssue[]> {
  const stdout = await execgpilot(["review", "--json"]);
  const parsed = JSON.parse(lastJsonLine(stdout));
  const result = reviewJsonSchema.parse(parsed);
  return result.issues.map((issue, idx) => ({
    id: `${issue.file}:${issue.line}:${idx}`,
    file: issue.file,
    line: issue.line,
    severity: issue.severity,
    comment: issue.comment,
    ...(typeof issue.suggestedFix === "string"
      ? { suggestedFix: issue.suggestedFix }
      : {}),
  }));
}

export async function fetchRepoStatus(): Promise<RepoStatus> {
  try {
    const stdout = await execgpilot(["status", "--json"]);
    const parsed = JSON.parse(lastJsonLine(stdout));
    const result = statusJsonSchema.parse(parsed);
    return {
      branch: result.branch,
      hasCommit: result.hasCommit,
      isBranchPushed: result.isBranchPushed,
      hasOpenPR: result.hasOpenPR,
      changedFiles: result.changedFiles,
    };
  } catch {
    return {
      branch: null,
      hasCommit: false,
      isBranchPushed: false,
      hasOpenPR: false,
      changedFiles: [],
    };
  }
}

export class gpilotStatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor(item?: vscode.StatusBarItem) {
    this.item =
      item ??
      vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = "gpilot.showPanel";
    this.setReady();
    this.item.show();
  }

  setRunning(): void {
    this.item.text = "$(sync~spin) gpilot running...";
    this.item.tooltip = "gpilot command in progress";
  }

  setReady(): void {
    this.item.text = "$(check) gpilot ready";
    this.item.tooltip = "gpilot is ready. Click to open the panel.";
  }

  dispose(): void {
    this.item.dispose();
  }
}

export async function readCurrentModel(
  workspaceRoot: string,
): Promise<{ provider: string; model: string } | null> {
  try {
    const raw = await readFile(
      join(workspaceRoot, "gpilot.config.yml"),
      "utf8",
    );
    const parsed = parseYaml(raw) as {
      ai?: { provider?: unknown; model?: unknown };
    } | null;
    const provider = parsed?.ai?.provider;
    const model = parsed?.ai?.model;
    if (typeof provider !== "string" || typeof model !== "string") return null;
    return { provider, model };
  } catch {
    return null;
  }
}

async function writeCurrentModel(
  workspaceRoot: string,
  provider: string,
  model: string,
): Promise<void> {
  const filePath = join(workspaceRoot, "gpilot.config.yml");
  const raw = await readFile(filePath, "utf8");
  const parsed = parseYaml(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ExtensionError(
      "gpilot.config.yml must be a YAML object at the root.",
    );
  }
  const next = parsed as Record<string, unknown>;
  const aiSection = next["ai"];
  const ai =
    aiSection && typeof aiSection === "object" && !Array.isArray(aiSection)
      ? (aiSection as Record<string, unknown>)
      : {};
  ai["provider"] = provider;
  ai["model"] = model;
  next["ai"] = ai;
  await writeFile(filePath, dumpYaml(next), "utf8");
}

function resolveWebviewDistUri(
  extensionUri: vscode.Uri,
): vscode.Uri | undefined {
  const candidates = [
    vscode.Uri.joinPath(extensionUri, "media", "webview"),
    vscode.Uri.joinPath(extensionUri, "..", "webview", "dist"),
    vscode.Uri.joinPath(extensionUri, "src", "packages", "webview", "dist"),
  ];
  return candidates.find((candidate) => existsSync(candidate.fsPath));
}

function resolveCodiconDistUri(
  extensionUri: vscode.Uri,
): vscode.Uri | undefined {
  const candidates = [
    vscode.Uri.joinPath(
      extensionUri,
      "node_modules",
      "@vscode",
      "codicons",
      "dist",
    ),
    vscode.Uri.joinPath(
      extensionUri,
      "..",
      "node_modules",
      "@vscode",
      "codicons",
      "dist",
    ),
    vscode.Uri.joinPath(
      extensionUri,
      "..",
      "..",
      "..",
      "node_modules",
      "@vscode",
      "codicons",
      "dist",
    ),
  ];
  return candidates.find((candidate) =>
    existsSync(join(candidate.fsPath, "codicon.css")),
  );
}

export class gpilotSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = VIEW_ID;

  private view?: vscode.WebviewView;
  private openedDiffs: Set<string> = new Set();
  private tabSubscription?: vscode.Disposable;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly statusBar: gpilotStatusBar,
    private readonly context: vscode.ExtensionContext,
  ) {}

  private extractDiffPath(tab: vscode.Tab): string | null {
    const root = workspaceRoot();
    if (!root) return null;
    const input = tab.input as
      | { modified?: vscode.Uri; original?: vscode.Uri; uri?: vscode.Uri }
      | undefined;
    // Staged-file diffs use the `git:` URI scheme on both sides (HEAD vs
    // index); working-tree diffs have `git:` on the left and `file:` on the
    // right. Either side carries the same workspace-relative path, so try
    // both schemes and either side.
    const candidates = [input?.modified, input?.original, input?.uri].filter(
      (uri): uri is vscode.Uri => uri instanceof vscode.Uri,
    );
    for (const uri of candidates) {
      if (uri.scheme !== "file" && uri.scheme !== "git") continue;
      const fsPath = uri.fsPath;
      if (!fsPath.startsWith(root)) continue;
      return fsPath.slice(root.length).replace(/^[\\/]+/, "");
    }
    return null;
  }

  private trackTabClose(): void {
    this.tabSubscription?.dispose();
    this.tabSubscription = vscode.window.tabGroups.onDidChangeTabs((event) => {
      let changed = false;
      for (const tab of event.closed) {
        const path = this.extractDiffPath(tab);
        if (path && this.openedDiffs.delete(path)) changed = true;
      }
      if (changed) this.broadcastOpenDiffs();
    });
    this.context.subscriptions.push(this.tabSubscription);
  }

  private broadcastOpenDiffs(): void {
    this.post({ type: "openDiffsUpdate", paths: Array.from(this.openedDiffs) });
  }

  private async closeDiffForPath(path: string): Promise<void> {
    const root = workspaceRoot();
    if (!root) return;
    const target = workspaceFileUri(path).fsPath;
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const tabPath = this.extractDiffPath(tab);
        if (tabPath && workspaceFileUri(tabPath).fsPath === target) {
          await vscode.window.tabGroups.close(tab);
        }
      }
    }
    this.openedDiffs.delete(path);
    this.broadcastOpenDiffs();
  }

  private async postSetupStatus(): Promise<void> {
    const mode = this.currentMode();
    const keyAi =
      (await hasSecret("ANTHROPIC_API_KEY")) ||
      (await hasSecret("OPENAI_API_KEY")) ||
      (await hasSecret("GEMINI_API_KEY"));
    const platformConfigured =
      (await hasSecret("GITHUB_TOKEN")) ||
      (await hasSecret("AZURE_DEVOPS_PAT")) ||
      (await hasSecret("GITLAB_TOKEN"));
    const root = workspaceRoot();
    const current = root ? await readCurrentModel(root) : null;
    const provider = current?.provider ?? "claude";
    // For Ollama, "AI configured" means the local server is reachable. For
    // hosted providers it means a key is saved in the keychain.
    const aiConfigured =
      provider === "ollama" ? await isOllamaReachable() : keyAi;
    const ready =
      mode === "native"
        ? true
        : provider === "ollama"
          ? aiConfigured && platformConfigured
          : keyAi && platformConfigured;
    this.post({
      type: "setupStatus",
      aiConfigured,
      platformConfigured,
      ready,
    });
  }

  public refreshState(): void {
    this.postState();
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    const webviewDistUri = resolveWebviewDistUri(this.extensionUri);
    const codiconDistUri = resolveCodiconDistUri(this.extensionUri);
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: webviewDistUri
        ? codiconDistUri
          ? [this.extensionUri, webviewDistUri, codiconDistUri]
          : [this.extensionUri, webviewDistUri]
        : codiconDistUri
          ? [this.extensionUri, codiconDistUri]
          : [this.extensionUri],
    };
    webviewView.webview.html = this.renderHtml(
      webviewView.webview,
      webviewDistUri,
      codiconDistUri,
    );
    webviewView.webview.onDidReceiveMessage(
      (message: ExtensionMessageFromWebview) => {
        void this.handleMessage(message);
      },
    );
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) this.postState();
    });
    this.trackTabClose();
    this.postState();
  }

  notifyModelChanged(provider: string, model: string): void {
    this.post({ type: "configUpdate", provider, model });
  }

  public getMode(): gpilotMode {
    return this.currentMode();
  }

  public async setMode(mode: gpilotMode): Promise<void> {
    await this.context.globalState.update(MODE_STATE_KEY, mode);
    this.post({ type: "modeUpdate", mode });
  }

  private currentMode(): gpilotMode {
    return this.context.globalState.get<gpilotMode>(MODE_STATE_KEY) ?? "gpilot";
  }

  private async handleMessage(
    message: ExtensionMessageFromWebview,
  ): Promise<void> {
    switch (message.type) {
      case "generateCommit": {
        await this.runWithStatus("commit", async () => {
          if (this.currentMode() === "native") {
            this.post({ type: "commitDraft", message: "" });
            return;
          }
          const draft = await generateCommitMessage();
          this.post({ type: "commitDraft", message: draft });
        });
        return;
      }
      case "commitMessage": {
        if (typeof message.message !== "string" || !message.message.trim()) {
          this.post({
            type: "commandFailed",
            command: "commit",
            error: "Commit message is empty.",
          });
          return;
        }
        await this.runWithStatus("commit", async () => {
          await commitWithMessage(message.message ?? "");
          await this.postRepoStatus();
        });
        return;
      }
      case "generatePr": {
        await this.runWithStatus("pr", async () => {
          if (this.currentMode() === "native") {
            this.post({ type: "prDraft", title: "", description: "" });
            return;
          }
          const draft = await generatePrDraft();
          this.post({
            type: "prDraft",
            title: draft.title,
            description: draft.description,
          });
        });
        return;
      }
      case "createPr": {
        await this.runWithStatus("pr", async () => {
          await pushAndCreatePr(message.title ?? "", message.description ?? "");
          await this.postRepoStatus();
        });
        return;
      }
      case "pushBranch": {
        await this.runWithStatus("push", async () => {
          await runShellCommand("git push -u origin HEAD");
          await this.postRepoStatus();
        });
        return;
      }
      case "publishReview": {
        await this.runWithStatus("publishReview", async () => {
          await runCommand("review", ["--publish"]);
        });
        return;
      }
      case "openPr": {
        await this.runWithStatus("openPr", async () => {
          await runShellCommand("gh pr view --web");
        });
        return;
      }
      case "previewFix": {
        await this.runWithStatus("previewFix", async () => {
          if (!message.issueId) {
            throw new ExtensionError("previewFix requires an issue id.");
          }
          await runCommand("fix", ["--comment", message.issueId, "--preview"]);
        });
        return;
      }
      case "applyFix": {
        await this.runWithStatus("applyFix", async () => {
          if (!message.issueId) {
            throw new ExtensionError("applyFix requires an issue id.");
          }
          await runCommand("fix", ["--comment", message.issueId]);
          await this.postRepoStatus();
        });
        return;
      }
      case "pickSpecFile": {
        await this.runWithStatus("spec", async () => {
          const picked = await pickRepoFile();
          if (picked) {
            this.post({ type: "specFilePicked", path: picked });
          }
        });
        return;
      }
      case "generateSpec": {
        await this.runWithStatus("spec", async () => {
          if (!message.path) {
            throw new ExtensionError("generateSpec requires a file path.");
          }
          const result = await generateSpecForFile(
            message.path,
            message.sections ?? [],
          );
          this.post({
            type: "specGenerated",
            path: result.path,
            preview: result.preview,
          });
        });
        return;
      }
      case "openSpec": {
        await this.runWithStatus("spec", async () => {
          if (!message.path) {
            throw new ExtensionError("openSpec requires a file path.");
          }
          const uri = workspaceFileUri(message.path);
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc, { preview: false });
        });
        return;
      }
      case "runReview": {
        await this.runWithStatus("review", async () => {
          if (this.currentMode() === "native") {
            this.post({ type: "reviewResult", issues: [] });
            return;
          }
          const issues = await fetchReview();
          this.post({ type: "reviewResult", issues });
        });
        return;
      }
      case "openWorkingTree": {
        await this.runWithStatus("workingTree", async () => {
          await runShellCommand("git status && git diff");
        });
        return;
      }
      case "openFileDiff": {
        await this.runWithStatus("workingTree", async () => {
          const path = message.path ?? "";
          if (!path) return;
          await openFileDiff(
            path,
            message.staged === true,
            message.status ?? "",
          );
          this.openedDiffs.add(path);
          this.broadcastOpenDiffs();
        });
        return;
      }
      case "closeFileDiff": {
        await this.runWithStatus("workingTree", async () => {
          const path = message.path ?? "";
          if (!path) return;
          await this.closeDiffForPath(path);
        });
        return;
      }
      case "stageFile": {
        await this.runWithStatus("workingTree", async () => {
          await stageFile(message.path ?? "");
          await this.postRepoStatus();
        });
        return;
      }
      case "unstageFile": {
        await this.runWithStatus("workingTree", async () => {
          await unstageFile(message.path ?? "");
          await this.postRepoStatus();
        });
        return;
      }
      case "switchModel": {
        if (!message.provider || !message.model) {
          throw new ExtensionError(
            "switchModel requires provider and model. Send both from the ModelSwitcher component.",
          );
        }
        const root = workspaceRoot();
        if (!root) {
          throw new ExtensionError(
            "Open a workspace folder to update gpilot.config.yml.",
          );
        }
        await writeCurrentModel(root, message.provider, message.model);
        await vscode.window.showInformationMessage(
          `gpilot: Switched model to ${message.provider}/${message.model}.`,
        );
        this.notifyModelChanged(message.provider, message.model);
        await this.postSetupStatus();
        return;
      }
      case "setMode": {
        if (message.mode !== "gpilot" && message.mode !== "native") {
          throw new ExtensionError(
            'setMode requires mode "gpilot" or "native".',
          );
        }
        await this.context.globalState.update(MODE_STATE_KEY, message.mode);
        this.post({ type: "modeUpdate", mode: message.mode });
        await this.postSetupStatus();
        return;
      }
      case "showPanel":
        await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
        return;
      case "setupKeys":
        await this.runWithStatus("setup", async () => {
          await manageApiKeys(async () => {
            await this.postSetupStatus();
          });
          await this.postSetupStatus();
        });
        return;
      case "refreshStatus":
        await this.postRepoStatus();
        return;
      case "requestState":
        this.postState();
        return;
    }
  }

  private async runWithStatus(
    command: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    this.post({ type: "commandRunning", command });
    this.statusBar.setRunning();
    try {
      await fn();
      this.post({ type: "commandDone", command });
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : String(error);
      this.post({ type: "commandFailed", command, error: messageText });
    } finally {
      this.statusBar.setReady();
    }
  }

  private postState(): void {
    void this.postSetupStatus();
    void this.postModelOptions();
    this.post({ type: "modeUpdate", mode: this.currentMode() });
    void this.postRepoStatus();
    this.broadcastOpenDiffs();
    const root = workspaceRoot();
    if (!root) return;
    void readCurrentModel(root).then((current) => {
      if (current) this.notifyModelChanged(current.provider, current.model);
    });
  }

  private async postRepoStatus(): Promise<void> {
    const status = await fetchRepoStatus();
    this.post({ type: "repoStatus", status });
  }

  private async postModelOptions(): Promise<void> {
    const dynamicOllama = await fetchLocalOllamaModelOptions();
    const merged = [...MODEL_OPTIONS, ...dynamicOllama];
    const seen = new Set<string>();
    const deduped = merged.filter((option) => {
      const key = `${option.provider}:${option.model}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    this.post({
      type: "modelOptionsUpdate",
      models: deduped.map((m) => ({
        label: m.label,
        provider: m.provider,
        model: m.model,
      })),
    });
  }

  private post(message: ExtensionMessageToWebview): void {
    void this.view?.webview.postMessage(message);
  }

  private renderHtml(
    webview: vscode.Webview,
    webviewDistUri?: vscode.Uri,
    codiconDistUri?: vscode.Uri,
  ): string {
    const scriptUri = webviewDistUri
      ? webview
          .asWebviewUri(
            vscode.Uri.joinPath(webviewDistUri, "assets", "index.js"),
          )
          .toString()
      : "";
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource};`;
    const codiconCssUri = codiconDistUri
      ? webview
          .asWebviewUri(vscode.Uri.joinPath(codiconDistUri, "codicon.css"))
          .toString()
      : "";
    const missingBundleNotice = webviewDistUri
      ? ""
      : '<p style="padding:12px;">Webview bundle not found. Run: npm run build in src/packages/extension.</p>';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <title>gpilot</title>
  ${codiconCssUri ? `<link href="${codiconCssUri}" rel="stylesheet" />` : ""}
</head>
<body style="margin:0;padding:0;background:transparent;">
  <div id="root"></div>
  ${missingBundleNotice}
  ${scriptUri ? `<script type="module" src="${scriptUri}"></script>` : ""}
</body>
</html>`;
  }
}

export async function pickAndSwitchModel(
  sidebar?: gpilotSidebarProvider,
): Promise<ModelOption | undefined> {
  const picked = await vscode.window.showQuickPick(
    MODEL_OPTIONS.map((m) => ({
      label: m.label,
      detail: m.detail,
      provider: m.provider,
      model: m.model,
    })),
    { placeHolder: "Select AI model" },
  );
  if (!picked) return undefined;
  const root = workspaceRoot();
  if (!root) {
    throw new ExtensionError(
      "Open a workspace folder to update gpilot.config.yml.",
    );
  }
  await writeCurrentModel(root, picked.provider, picked.model);
  await vscode.window.showInformationMessage(
    `gpilot: Switched to ${picked.label}`,
  );
  sidebar?.notifyModelChanged(picked.provider, picked.model);
  return {
    label: picked.label,
    detail: picked.detail,
    provider: picked.provider,
    model: picked.model,
  };
}

export async function promptAndReviewPR(): Promise<void> {
  const prId = await vscode.window.showInputBox({
    prompt: "PR number (leave empty for local diff review)",
    placeHolder: "142",
  });
  await runCommand("review", prId ? ["--pr", prId] : []);
}

interface RegisterOptions {
  sidebar: gpilotSidebarProvider;
  statusBar: gpilotStatusBar;
}

export function registerCommands(
  context: vscode.ExtensionContext,
  options: RegisterOptions,
): void {
  const { sidebar, statusBar } = options;

  const wrap =
    <A extends unknown[]>(fn: (...args: A) => Promise<void> | void) =>
    async (...args: A): Promise<void> => {
      statusBar.setRunning();
      try {
        await fn(...args);
      } finally {
        statusBar.setReady();
      }
    };

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "gpilot.commit",
      wrap(() => runCommand("commit")),
    ),
    vscode.commands.registerCommand(
      "gpilot.createPR",
      wrap(() => runCommand("pr")),
    ),
    vscode.commands.registerCommand("gpilot.reviewPR", wrap(promptAndReviewPR)),
    vscode.commands.registerCommand(
      "gpilot.fixAllBlockers",
      wrap(() => runCommand("fix", ["--all"])),
    ),
    vscode.commands.registerCommand(
      "gpilot.fixComment",
      wrap(async (commentId?: string, prId?: string) => {
        const args: string[] = [];
        if (prId) args.push("--pr", prId);
        if (commentId) args.push("--comment", commentId);
        await runCommand("fix", args);
      }),
    ),
    vscode.commands.registerCommand(
      "gpilot.switchModel",
      wrap(async () => {
        await pickAndSwitchModel(sidebar);
      }),
    ),
    vscode.commands.registerCommand(
      "gpilot.auth",
      wrap(async () => {
        await manageApiKeys();
        sidebar.refreshState();
      }),
    ),
    vscode.commands.registerCommand("gpilot.showPanel", () =>
      vscode.commands.executeCommand(`${VIEW_ID}.focus`),
    ),
    vscode.commands.registerCommand(
      "gpilot.status",
      wrap(() => runCommand("status")),
    ),
    vscode.commands.registerCommand(
      "gpilot.toggleMode",
      wrap(async () => {
        const next: gpilotMode =
          sidebar.getMode() === "gpilot" ? "native" : "gpilot";
        await sidebar.setMode(next);
        await vscode.window.showInformationMessage(
          `gpilot: Mode set to ${next === "gpilot" ? "gpilot (AI)" : "Native Git"}.`,
        );
      }),
    ),
  );
}

interface ActivateInternals {
  sidebar: gpilotSidebarProvider;
  statusBar: gpilotStatusBar;
}

const state: { internals: ActivateInternals | undefined } = {
  internals: undefined,
};

export function activate(context: vscode.ExtensionContext): ActivateInternals {
  const statusBar = new gpilotStatusBar();
  context.subscriptions.push({ dispose: () => statusBar.dispose() });

  const sidebar = new gpilotSidebarProvider(
    context.extensionUri,
    statusBar,
    context,
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      gpilotSidebarProvider.viewType,
      sidebar,
    ),
  );

  registerCommands(context, { sidebar, statusBar });

  void runFirstLaunchSetupIfNeeded(context);

  state.internals = { sidebar, statusBar };
  return state.internals;
}

export function deactivate(): void {
  state.internals?.statusBar.dispose();
  state.internals = undefined;
}
