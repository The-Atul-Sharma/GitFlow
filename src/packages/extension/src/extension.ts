import * as vscode from 'vscode';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { load as parseYaml } from 'js-yaml';

export type PipelineStatus = 'idle' | 'running' | 'done' | 'failed';

export type ReviewSeverity = 'blocker' | 'warning' | 'info';

export interface PipelineStep {
  id: string;
  label: string;
  status: PipelineStatus;
}

export interface ReviewIssue {
  id: string;
  file: string;
  line: number;
  severity: ReviewSeverity;
  comment: string;
}

export interface ModelOption {
  label: string;
  detail: string;
  provider: string;
  model: string;
}

export interface ExtensionMessageFromWebview {
  type:
    | 'fixComment'
    | 'dismissComment'
    | 'switchModel'
    | 'generateClaudeMd'
    | 'generateSpec'
    | 'showPanel'
    | 'requestState';
  prId?: string;
  commentId?: string;
  provider?: string;
  model?: string;
}

export interface ExtensionMessageToWebview {
  type: 'pipeline' | 'reviewComplete' | 'modelChanged' | 'state';
  steps?: PipelineStep[];
  issues?: ReviewIssue[];
  provider?: string;
  model?: string;
}

export class ExtensionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtensionError';
  }
}

export const VIEW_ID = 'gitflow.panel';

export const FIRST_LAUNCH_STATE_KEY = 'gitflow.firstLaunchComplete';

export type SecretKey =
  | 'ANTHROPIC_API_KEY'
  | 'OPENAI_API_KEY'
  | 'GEMINI_API_KEY'
  | 'GITHUB_TOKEN'
  | 'AZURE_DEVOPS_PAT'
  | 'GITLAB_TOKEN';

interface SecretDescriptor {
  key: SecretKey;
  label: string;
  detail: string;
}

export const SECRET_DESCRIPTORS: ReadonlyArray<SecretDescriptor> = [
  { key: 'ANTHROPIC_API_KEY', label: 'Anthropic API key', detail: 'Required for Claude models' },
  { key: 'OPENAI_API_KEY', label: 'OpenAI API key', detail: 'Required for GPT models' },
  { key: 'GEMINI_API_KEY', label: 'Gemini API key', detail: 'Required for Gemini models' },
  { key: 'GITHUB_TOKEN', label: 'GitHub token', detail: 'Required to create / review GitHub PRs' },
  { key: 'AZURE_DEVOPS_PAT', label: 'Azure DevOps PAT', detail: 'Required for Azure DevOps PRs' },
  { key: 'GITLAB_TOKEN', label: 'GitLab token', detail: 'Required for GitLab MRs' },
];

export const DEFAULT_PIPELINE: ReadonlyArray<PipelineStep> = [
  { id: 'commit', label: 'Commit message', status: 'idle' },
  { id: 'pr', label: 'PR created', status: 'idle' },
  { id: 'description', label: 'PR description', status: 'idle' },
  { id: 'review', label: 'PR review', status: 'idle' },
  { id: 'fix', label: 'Fix comments', status: 'idle' },
];

export const MODEL_OPTIONS: ReadonlyArray<ModelOption> = [
  {
    label: 'Claude Sonnet 4.6',
    detail: 'Fast and smart — recommended',
    provider: 'claude',
    model: 'claude-sonnet-4-6',
  },
  {
    label: 'Claude Opus 4.6',
    detail: 'Most capable, slower',
    provider: 'claude',
    model: 'claude-opus-4-6',
  },
  {
    label: 'GPT-4o',
    detail: 'OpenAI — requires OPENAI_API_KEY',
    provider: 'openai',
    model: 'gpt-4o',
  },
  {
    label: 'Gemini 1.5 Pro',
    detail: 'Google — requires GEMINI_API_KEY',
    provider: 'gemini',
    model: 'gemini-1.5-pro',
  },
  {
    label: 'Ollama (local)',
    detail: 'Free, runs on your machine',
    provider: 'ollama',
    model: 'llama3',
  },
];

const TERMINAL_NAME = 'gitflow';

const SECRETS_SERVICE_NAME = 'gitflow';

interface KeytarLike {
  setPassword(service: string, account: string, password: string): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

let keytarPromise: Promise<KeytarLike | null> | null = null;

async function loadKeytar(): Promise<KeytarLike | null> {
  if (keytarPromise) return keytarPromise;
  keytarPromise = (async () => {
    try {
      const mod = (await import('keytar')) as KeytarLike | { default: KeytarLike };
      return 'default' in mod && mod.default ? mod.default : (mod as KeytarLike);
    } catch {
      return null;
    }
  })();
  return keytarPromise;
}

/**
 * Whether a secret is present in the OS keychain. Mirrors what the CLI's
 * core/secrets store will see when spawned from the extension's terminal.
 */
export async function hasSecret(key: SecretKey): Promise<boolean> {
  const keytar = await loadKeytar();
  if (!keytar) return false;
  const value = await keytar.getPassword(SECRETS_SERVICE_NAME, key);
  return Boolean(value);
}

/** Persist a secret to the OS keychain under the gitflow service. */
export async function setSecret(key: SecretKey, value: string): Promise<void> {
  const keytar = await loadKeytar();
  if (!keytar) {
    throw new ExtensionError(
      'Cannot save API key: native keychain module (keytar) failed to load. On Linux, install libsecret-1-dev and reload VS Code.',
    );
  }
  await keytar.setPassword(SECRETS_SERVICE_NAME, key, value);
}

/** Remove a secret from the OS keychain. No-op if it was never set. */
export async function deleteSecret(key: SecretKey): Promise<void> {
  const keytar = await loadKeytar();
  if (!keytar) return;
  await keytar.deletePassword(SECRETS_SERVICE_NAME, key);
}

/**
 * Show an InputBox to capture a single secret and persist it. Empty input
 * cancels the prompt without touching the existing value.
 */
export async function promptForSecret(descriptor: SecretDescriptor): Promise<boolean> {
  const existed = await hasSecret(descriptor.key);
  const value = await vscode.window.showInputBox({
    prompt: `${descriptor.label} — ${descriptor.detail}`,
    placeHolder: existed ? 'Leave empty to keep current value' : 'Paste the key here',
    password: true,
    ignoreFocusOut: true,
  });
  if (value === undefined) return false;
  if (value === '') return existed;
  await setSecret(descriptor.key, value);
  await vscode.window.showInformationMessage(`gitflow: Saved ${descriptor.label}.`);
  return true;
}

/**
 * Top-level "manage API keys" flow: lists every supported secret with its
 * current state, lets the user pick one to set or clear. Loops until the
 * user dismisses the picker.
 */
export async function manageApiKeys(): Promise<void> {
  while (true) {
    const items: Array<vscode.QuickPickItem & { descriptor?: SecretDescriptor; action?: 'clear' }> = [];
    for (const d of SECRET_DESCRIPTORS) {
      const set = await hasSecret(d.key);
      items.push({
        label: `${set ? '$(check)' : '$(circle-large-outline)'} ${d.label}`,
        description: set ? 'set' : 'not set',
        detail: d.detail,
        descriptor: d,
      });
    }
    items.push({ label: '$(trash) Clear a saved key…', action: 'clear' });

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select an API key to set or update',
      ignoreFocusOut: true,
    });
    if (!picked) return;

    if (picked.action === 'clear') {
      await clearSecretFlow();
      continue;
    }
    if (picked.descriptor) {
      await promptForSecret(picked.descriptor);
    }
  }
}

async function clearSecretFlow(): Promise<void> {
  const items: Array<vscode.QuickPickItem & { descriptor: SecretDescriptor }> = [];
  for (const d of SECRET_DESCRIPTORS) {
    if (await hasSecret(d.key)) {
      items.push({ label: d.label, detail: d.detail, descriptor: d });
    }
  }
  if (items.length === 0) {
    await vscode.window.showInformationMessage('gitflow: No saved keys to clear.');
    return;
  }
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a key to remove from the keychain',
    ignoreFocusOut: true,
  });
  if (!picked) return;
  await deleteSecret(picked.descriptor.key);
  await vscode.window.showInformationMessage(`gitflow: Cleared ${picked.descriptor.label}.`);
}

/**
 * On the first activation in a given VS Code profile, ask the user to
 * configure at least one AI provider key so the CLI can authenticate when
 * spawned from the extension. Sets a globalState flag so this runs once.
 */
export async function runFirstLaunchSetupIfNeeded(
  context: vscode.ExtensionContext,
): Promise<void> {
  const done = context.globalState.get<boolean>(FIRST_LAUNCH_STATE_KEY);
  if (done) return;

  const choice = await vscode.window.showInformationMessage(
    'gitflow needs an AI provider API key to run. Set it now?',
    'Set up keys',
    'Later',
  );
  if (choice === 'Set up keys') {
    await manageApiKeys();
  }
  await context.globalState.update(FIRST_LAUNCH_STATE_KEY, true);
}

const runCommandSchema = z.object({
  command: z
    .string()
    .min(1, 'command must be a non-empty string. Pass a CLI subcommand like "commit" or "pr".'),
  args: z
    .array(z.string())
    .default([])
    .refine(
      (a) => a.every((s) => typeof s === 'string'),
      'args must be an array of strings. Stringify any non-string values before passing them in.',
    ),
});

const issueSchema = z.object({
  id: z.string().min(1, 'issue.id must be a non-empty string. Use the comment id from the platform API.'),
  file: z.string().min(1, 'issue.file must be a non-empty file path. Use the path from the review payload.'),
  line: z.number().int().nonnegative('issue.line must be a non-negative integer. Use 0 for file-level comments.'),
  severity: z.enum(['blocker', 'warning', 'info']),
  comment: z.string().min(1, 'issue.comment must be non-empty. Pass the review comment body.'),
});

/**
 * Spawn a VS Code terminal and run a gitflow CLI command in it. The
 * extension host never imports CLI modules directly — it always shells
 * out via `npx gitflow`.
 */
export async function runCommand(command: string, args: string[] = []): Promise<void> {
  const parsed = runCommandSchema.parse({ command, args });
  const terminal = findOrCreateTerminal();
  terminal.show();
  const line = `npx gitflow ${parsed.command}${parsed.args.length ? ' ' + parsed.args.join(' ') : ''}`;
  terminal.sendText(line);
}

function findOrCreateTerminal(): vscode.Terminal {
  const existing = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME);
  if (existing) return existing;
  return vscode.window.createTerminal(TERMINAL_NAME);
}

/**
 * Status bar item that reflects gitflow pipeline state. Always visible
 * while the extension is active. Clicking it focuses the sidebar panel.
 */
export class GitFlowStatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor(item?: vscode.StatusBarItem) {
    this.item =
      item ??
      vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'gitflow.showPanel';
    this.setReady();
    this.item.show();
  }

  /** Show the spinning indicator while a CLI command is in flight. */
  setRunning(): void {
    this.item.text = '$(sync~spin) gitflow running...';
    this.item.tooltip = 'gitflow command in progress';
  }

  /** Reset to the idle state once the command finishes. */
  setReady(): void {
    this.item.text = '$(check) gitflow ready';
    this.item.tooltip = 'gitflow is ready. Click to open the panel.';
  }

  /** Highlight the count of blocker comments after a review completes. */
  setBlockers(count: number): void {
    const parsed = z
      .number()
      .int()
      .nonnegative('blocker count must be a non-negative integer. Pass 0 if no blockers were found.')
      .parse(count);
    if (parsed === 0) {
      this.setReady();
      return;
    }
    this.item.text = `$(alert) ${parsed} blocker${parsed === 1 ? '' : 's'}`;
    this.item.tooltip = 'gitflow review found blockers. Click to view.';
  }

  /** Release the underlying VS Code resource. */
  dispose(): void {
    this.item.dispose();
  }
}

/**
 * Read the current AI provider + model from gitflow.config.yml in the
 * given workspace root. Returns null when the file is missing or
 * malformed so callers can fall back to the default.
 */
export async function readCurrentModel(
  workspaceRoot: string,
): Promise<{ provider: string; model: string } | null> {
  const root = z
    .string()
    .min(1, 'workspaceRoot must be a non-empty path. Pass workspaceFolders[0].uri.fsPath.')
    .parse(workspaceRoot);
  try {
    const raw = await readFile(join(root, 'gitflow.config.yml'), 'utf8');
    const parsed = parseYaml(raw) as { ai?: { provider?: unknown; model?: unknown } } | null;
    const provider = parsed?.ai?.provider;
    const model = parsed?.ai?.model;
    if (typeof provider !== 'string' || typeof model !== 'string') return null;
    return { provider, model };
  } catch {
    return null;
  }
}

/**
 * Sidebar webview provider. Bridges postMessage between the React
 * webview (built separately from the `webview` package) and the
 * extension host. Handles fixComment, switchModel, and spec actions.
 */
export class GitFlowSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = VIEW_ID;

  private view?: vscode.WebviewView;
  private pipeline: PipelineStep[] = DEFAULT_PIPELINE.map((s) => ({ ...s }));
  private issues: ReviewIssue[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly statusBar: GitFlowStatusBar,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.html = this.renderHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((message: ExtensionMessageFromWebview) => {
      void this.handleMessage(message);
    });
    this.postState();
  }

  /** Push a new pipeline step status to the webview and refresh state. */
  updateStep(stepId: string, status: PipelineStatus): void {
    const id = z
      .string()
      .min(1, 'stepId must be a non-empty string. Use one of the ids in DEFAULT_PIPELINE.')
      .parse(stepId);
    const next = this.pipeline.map((s) => (s.id === id ? { ...s, status } : s));
    if (!next.some((s) => s.id === id)) {
      throw new ExtensionError(
        `Unknown pipeline step "${id}". Add it to DEFAULT_PIPELINE before updating its status.`,
      );
    }
    this.pipeline = next;
    this.post({ type: 'pipeline', steps: this.pipeline });
  }

  /** Replace the review issues panel and update the status bar count. */
  setReviewIssues(issues: ReviewIssue[]): void {
    const parsed = z
      .array(issueSchema)
      .parse(issues);
    this.issues = parsed;
    this.post({ type: 'reviewComplete', issues: this.issues });
    const blockers = this.issues.filter((i) => i.severity === 'blocker').length;
    this.statusBar.setBlockers(blockers);
  }

  /** Notify the webview that the active model changed. */
  notifyModelChanged(provider: string, model: string): void {
    this.post({
      type: 'modelChanged',
      provider: z.string().min(1, 'provider must be non-empty. Use one of the MODEL_OPTIONS providers.').parse(provider),
      model: z.string().min(1, 'model must be non-empty. Use one of the MODEL_OPTIONS model ids.').parse(model),
    });
  }

  private async handleMessage(message: ExtensionMessageFromWebview): Promise<void> {
    switch (message.type) {
      case 'fixComment': {
        if (!message.prId || !message.commentId) {
          throw new ExtensionError(
            'fixComment requires both prId and commentId. Include them in the postMessage payload from the webview.',
          );
        }
        await runCommand('fix', ['--pr', message.prId, '--comment', message.commentId]);
        break;
      }
      case 'dismissComment': {
        this.issues = this.issues.filter((i) => i.id !== message.commentId);
        this.post({ type: 'reviewComplete', issues: this.issues });
        const blockers = this.issues.filter((i) => i.severity === 'blocker').length;
        this.statusBar.setBlockers(blockers);
        break;
      }
      case 'switchModel': {
        if (!message.provider || !message.model) {
          throw new ExtensionError(
            'switchModel requires provider and model. Send both from the ModelSwitcher component.',
          );
        }
        await runCommand('config set', [
          `ai.provider ${message.provider}`,
          `ai.model ${message.model}`,
        ]);
        this.notifyModelChanged(message.provider, message.model);
        break;
      }
      case 'generateClaudeMd':
        await runCommand('init');
        break;
      case 'generateSpec':
        await runCommand('spec');
        break;
      case 'showPanel':
        await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
        break;
      case 'requestState':
        this.postState();
        break;
    }
  }

  private postState(): void {
    this.post({ type: 'pipeline', steps: this.pipeline });
    this.post({ type: 'reviewComplete', issues: this.issues });
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return;
    void readCurrentModel(root).then((current) => {
      if (current) this.notifyModelChanged(current.provider, current.model);
    });
  }

  private post(message: ExtensionMessageToWebview): void {
    void this.view?.webview.postMessage(message);
  }

  private renderHtml(webview: vscode.Webview): string {
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource};`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <title>gitflow</title>
</head>
<body>
  <div id="root"></div>
</body>
</html>`;
  }
}

/**
 * Show the model picker, persist the selection through the CLI, and
 * notify the sidebar so the dropdown reflects the new value.
 */
export async function pickAndSwitchModel(
  sidebar?: GitFlowSidebarProvider,
): Promise<ModelOption | undefined> {
  const picked = await vscode.window.showQuickPick(
    MODEL_OPTIONS.map((m) => ({
      label: m.label,
      detail: m.detail,
      provider: m.provider,
      model: m.model,
    })),
    { placeHolder: 'Select AI model' },
  );
  if (!picked) return undefined;
  await runCommand('config set', [
    `ai.provider ${picked.provider}`,
    `ai.model ${picked.model}`,
  ]);
  await vscode.window.showInformationMessage(`gitflow: Switched to ${picked.label}`);
  sidebar?.notifyModelChanged(picked.provider, picked.model);
  return { label: picked.label, detail: picked.detail, provider: picked.provider, model: picked.model };
}

/**
 * Prompt for a PR number and run the review command. Cancelling the
 * input box runs review against the local diff (no --pr flag).
 */
export async function promptAndReviewPR(): Promise<void> {
  const prId = await vscode.window.showInputBox({
    prompt: 'PR number (leave empty for local diff review)',
    placeHolder: '142',
  });
  await runCommand('review', prId ? ['--pr', prId] : []);
}

interface RegisterOptions {
  sidebar: GitFlowSidebarProvider;
  statusBar: GitFlowStatusBar;
}

/**
 * Register every gitflow.* command listed in the extension spec.
 * Each command spawns a terminal and runs the matching CLI subcommand.
 */
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
    vscode.commands.registerCommand('gitflow.commit', wrap(() => runCommand('commit'))),
    vscode.commands.registerCommand('gitflow.createPR', wrap(() => runCommand('pr'))),
    vscode.commands.registerCommand('gitflow.reviewPR', wrap(promptAndReviewPR)),
    vscode.commands.registerCommand(
      'gitflow.fixAllBlockers',
      wrap(() => runCommand('fix', ['--all'])),
    ),
    vscode.commands.registerCommand(
      'gitflow.fixComment',
      wrap(async (commentId?: string, prId?: string) => {
        const args: string[] = [];
        if (prId) args.push('--pr', prId);
        if (commentId) args.push('--comment', commentId);
        await runCommand('fix', args);
      }),
    ),
    vscode.commands.registerCommand(
      'gitflow.generateSpec',
      wrap(async () => {
        const active = vscode.window.activeTextEditor?.document.uri.fsPath;
        await runCommand('spec', active ? [active] : []);
      }),
    ),
    vscode.commands.registerCommand(
      'gitflow.generateClaudeMd',
      wrap(() => runCommand('init')),
    ),
    vscode.commands.registerCommand(
      'gitflow.switchModel',
      wrap(async () => {
        await pickAndSwitchModel(sidebar);
      }),
    ),
    vscode.commands.registerCommand('gitflow.auth', wrap(manageApiKeys)),
    vscode.commands.registerCommand('gitflow.showPanel', () =>
      vscode.commands.executeCommand(`${VIEW_ID}.focus`),
    ),
    vscode.commands.registerCommand('gitflow.status', wrap(() => runCommand('status'))),
  );
}

interface ActivateInternals {
  sidebar: GitFlowSidebarProvider;
  statusBar: GitFlowStatusBar;
}

const state: { internals: ActivateInternals | undefined } = { internals: undefined };

/**
 * VS Code entry point. Wires up the status bar, sidebar webview, and
 * every gitflow.* command. Called automatically by VS Code on the
 * `onStartupFinished` activation event.
 */
export function activate(context: vscode.ExtensionContext): ActivateInternals {
  z.object({
    subscriptions: z.array(z.unknown()),
    extensionUri: z.unknown().refine(
      (v) => v !== undefined && v !== null,
      'context.extensionUri must be set. VS Code provides it on the ExtensionContext at activation.',
    ),
  }).parse({ subscriptions: context.subscriptions, extensionUri: context.extensionUri });

  const statusBar = new GitFlowStatusBar();
  context.subscriptions.push({ dispose: () => statusBar.dispose() });

  const sidebar = new GitFlowSidebarProvider(context.extensionUri, statusBar);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(GitFlowSidebarProvider.viewType, sidebar),
  );

  registerCommands(context, { sidebar, statusBar });

  void runFirstLaunchSetupIfNeeded(context);

  state.internals = { sidebar, statusBar };
  return state.internals;
}

/** VS Code shutdown hook. Releases status bar and sidebar resources. */
export function deactivate(): void {
  state.internals?.statusBar.dispose();
  state.internals = undefined;
}
