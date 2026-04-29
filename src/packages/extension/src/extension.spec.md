# Module: vscode-extension

## Purpose

Expose the gitpilot workflow inside VS Code via a sidebar webview, the
command palette, and source-control context menus. Users never need a
terminal — commit, PR, review, fix, and spec generation all run from
the panel.

## Two parts

1. **Extension host** — `packages/extension/src/extension.ts`. Pure
   TypeScript, talks to the VS Code API, shells out to the
   [`gitpilot`](https://www.npmjs.com/package/gitpilot) CLI for
   commit / PR / review / fix actions, and calls AI provider HTTP
   endpoints directly for spec generation. Holds `Set<string>` of
   open diff tabs and listens to `tabGroups.onDidChangeTabs` to keep
   the webview in sync with VS Code's editor state.
2. **Webview panel** — `packages/webview/`. React + Vite, compiled to
   a single `dist/assets/index.js` that the host loads with a CSP
   limited to `webview.cspSource`.

## Commands registered (command palette via Cmd+Shift+P)

| Command ID                | Label                                       |
| ------------------------- | ------------------------------------------- |
| `gitpilot.commit`         | gitpilot: Generate commit message           |
| `gitpilot.createPR`       | gitpilot: Create PR with description        |
| `gitpilot.reviewPR`       | gitpilot: Review current PR                 |
| `gitpilot.fixAllBlockers` | gitpilot: Fix all blocker comments          |
| `gitpilot.fixComment`     | gitpilot: Fix selected comment              |
| `gitpilot.switchModel`    | gitpilot: Switch AI model                   |
| `gitpilot.auth`           | gitpilot: Setup or update API keys          |
| `gitpilot.showPanel`      | gitpilot: Show panel                        |
| `gitpilot.status`         | gitpilot: Show status                       |
| `gitpilot.toggleMode`     | gitpilot: Toggle between AI and Native Git  |

## Sidebar layout (delegated to the webview)

The host registers a `WebviewViewProvider` (`gitpilot.panel`) that
renders the React four-tab UI: **Commit / Pull Request / PR Review /
Spec MD**, with a header (status dot, AI on/off toggle, model
selector) and a footer (provider connection state, Manage Keys). See
`packages/webview/webview.spec.md` for the per-tab UX.

The host's responsibility is the message protocol, the CLI / AI
calls behind it, and tab-state tracking — never UI styling.

## Mode handling

`globalState[gitpilot.mode]` holds either `"gitpilot"` or `"native"`
(default `"gitpilot"`). The header AI toggle is wired to this:

- `gitpilot` → AI mode on, all tabs interactive.
- `native` → AI mode off, the webview locks every tab behind the
  AiOffBanner overlay.

The `gitpilot.toggleMode` palette command flips the value and posts
`modeUpdate` so the sidebar reflects the change immediately. Mode is
persisted across sessions.

## Setup status

`postSetupStatus()` runs on every `requestState` and on
`onDidChangeVisibility`. It computes:

```ts
{
  aiConfigured,       // true if the active provider is reachable / keyed
  platformConfigured, // true if any platform token is in the keychain
  ready,              // mode === native, OR (aiConfigured && platformConfigured),
                      // OR (provider === ollama && platformConfigured && ollamaUp)
}
```

For the Ollama provider, `aiConfigured` is the result of `isOllamaReachable()`
— a `Promise.race`-style helper that calls `fetch("http://localhost:11434/api/tags")`
with an explicit 1s timeout ceiling so half-open sockets / DNS hangs
can't keep the panel stuck on "Ollama running". For hosted providers,
`aiConfigured` is whether any of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`
/ `GEMINI_API_KEY` exists in the keychain.

## CLI invocation paths

The host calls the CLI three ways depending on what the user is doing:

1. **Captured stdout** (`execgitpilot(args)` →
   `child_process.execFile`) — used by `gitpilot commit --dry-run`,
   `gitpilot pr create --dry-run`, `gitpilot review --json`, and
   `gitpilot status --json`. Output is parsed as JSON and forwarded
   to the webview as a typed message. Before invoking, the host
   hydrates `process.env` from the OS keychain (`ANTHROPIC_API_KEY`,
   `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GITHUB_TOKEN`,
   `AZURE_DEVOPS_PAT`, `GITLAB_TOKEN`) so the spawned CLI sees them
   without `.env` files. On non-zero exit or empty stdout the host
   throws a descriptive `ExtensionError` mentioning both possibilities
   ("CLI not installed" vs "API key missing").
2. **Direct AI call** — Spec MD generation calls the configured
   provider's HTTP API directly (`/v1/messages` for Anthropic,
   `/v1/chat/completions` for OpenAI, `:generateContent` for Gemini,
   `/api/generate` for Ollama). Falls back to a deterministic
   structural parse of the source file when no key is configured.
3. **Terminal** (`vscode.window.createTerminal({ name: "gitpilot" })`)
   — used by palette commands, fix flows, `gh pr create`, and
   `git push -u origin HEAD` so the user can see streaming output and
   answer interactive prompts. The same terminal is reused.

## Diff tab tracking

The provider keeps `private openedDiffs: Set<string>` of workspace-relative
paths. Two flows mutate it:

- **Open** (`openFileDiff(path, staged)`):
  - `staged === true`: `vscode.diff(gitUri(path, "HEAD"), gitUri(path, "~"), title)`
    — HEAD ↔ index, what `git diff --staged` shows.
  - `staged === false`: `vscode.diff(gitUri(path, "HEAD"), fileUri(path), title)`
    — HEAD ↔ working tree.
  - Both passed `{ preview: false }` and immediately followed by
    `workbench.action.keepEditor` so multiple diffs can stay open at
    once instead of replacing a single preview tab.
  - `path` added to `openedDiffs`; `openDiffsUpdate { paths: […] }` is
    broadcast.
- **Close** (`closeFileDiff(path)`): walks `vscode.window.tabGroups.all`,
  finds matching tabs via `extractDiffPath(tab)`, calls
  `tabGroups.close(tab)`. Path is removed and the new list is
  broadcast.

`extractDiffPath(tab)` accepts both `file:` and `git:` URIs (staged
diffs use `git:` on both sides, working-tree diffs have `git:` on the
left and `file:` on the right) and checks `input.modified`,
`input.original`, and `input.uri` in turn.

A `tabGroups.onDidChangeTabs` subscription registered in
`resolveWebviewView` mirrors editor-side closes back into the panel —
when the user closes a diff tab from the editor, the matching path is
removed from `openedDiffs` and `openDiffsUpdate` is broadcast, which
clears the row's blue highlight in the panel.

`postState()` re-broadcasts `openDiffsUpdate` on every `requestState`,
so a freshly mounted webview is in sync.

## Spec generation

`generateSpecForFile(relativePath, sections)` runs in two stages:

1. Build a prompt that:
   - Names the file and lists detected exports.
   - Lists exactly the sections the webview asked for.
   - Tells the AI not to add TODO placeholders.
   - Inlines the source code in a fence.
2. `callConfiguredAi(prompt)` reads `gitpilot.config.yml` for provider
   and model, pulls the matching key from the keychain, and posts to
   the right HTTP endpoint:

   | Provider  | Endpoint                                                  |
   | --------- | --------------------------------------------------------- |
   | claude    | `https://api.anthropic.com/v1/messages`                   |
   | openai    | `https://api.openai.com/v1/chat/completions`              |
   | gemini    | `https://generativelanguage.googleapis.com/v1beta/...`    |
   | ollama    | `http://localhost:11434/api/generate`                     |

   On HTTP error: throws `ExtensionError` with the upstream status +
   body so the panel banner shows the actual cause.

   On no key (and provider isn't Ollama): returns `null`.

3. If AI returned non-empty text, write it as `<basename>.spec.md`. If
   not (no key configured), fall through to the structural fallback
   `buildHeuristicSpec(...)` that parses real exports from the source
   (with JSDoc), infers a usage block, and lists thrown errors / async
   surface area / guard branches as edge-case content. Never writes
   TODO placeholders.

The webview receives `specGenerated { path, preview }` and renders an
inline preview with an Open ↗ button (`openSpec` → opens the file
non-preview).

## Webview ↔ host message protocol

Inbound (host → webview): `setupStatus`, `configUpdate`,
`modelOptionsUpdate`, `commandRunning` / `commandDone` /
`commandFailed`, `commitDraft`, `prDraft`, `reviewResult`,
`repoStatus`, `modeUpdate`, `specFilePicked`, `specGenerated`,
`openDiffsUpdate`.

Outbound (webview → host): `requestState`, `refreshStatus`,
`setupKeys`, `switchModel`, `setMode`, `generateCommit`,
`commitMessage`, `generatePr`, `createPr`, `pushBranch`, `runReview`,
`publishReview`, `openPr`, `previewFix`, `applyFix`, `openWorkingTree`,
`openFileDiff` (carries `staged`), `closeFileDiff`, `stageFile`,
`unstageFile`, `pickSpecFile`, `generateSpec`, `openSpec`.

All payloads validated with `zod` at the webview boundary; the host
side uses TypeScript narrowing on the discriminated `type` field.

## File picker for Spec MD

`pickRepoFile()` runs `vscode.workspace.findFiles("**/*",
"{**/node_modules/**,**/.git/**,**/dist/**,**/out/**}", 1000)` and
shows the result as a `vscode.window.showQuickPick`. Returns the
relative path (or `null` if cancelled), and the host posts
`specFilePicked { path }`.

## Status bar item

`gitpilotStatusBar` registers a single status bar entry on the left:

- `$(check) gitpilot ready` when idle.
- `$(sync~spin) gitpilot running...` while any host action is in
  flight.
- Click invokes `gitpilot.showPanel` which focuses the sidebar.

Updated by every `runWithStatus(command, fn)` wrapper on the
provider so the entry always reflects in-flight state.

## API key management

Inside VS Code the user never runs `gitpilot auth`. The extension
owns the secret-setup UX:

- On first activation per VS Code profile, `runFirstLaunchSetupIfNeeded`
  prompts to set up keys. A `gitpilot.firstLaunchComplete` flag in
  `context.globalState` ensures this runs once.
- The setup screen in the panel and the `gitpilot.auth` command both
  open `manageApiKeys()`, a quick-pick that walks every secret slot
  and prompts via `vscode.window.showInputBox({ password: true })`.
- Keys are written to the OS keychain via `keytar` under the service
  name `gitpilot` with the canonical account names: `ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GITHUB_TOKEN`,
  `AZURE_DEVOPS_PAT`, `GITLAB_TOKEN`.
- `execgitpilot` hydrates `process.env` from these slots before
  spawning, so CLI subprocesses see them without any extra config.
- The webview never receives, displays, or asks for a secret value.

## package.json contributes

- `name`: `gitpilot`, `displayName`: `GitPilot`, `publisher`:
  `atsharma`.
- `categories`: `["SCM Providers", "AI", "Other"]`.
- `activationEvents`: `["onStartupFinished"]`.
- `contributes.commands`: every command listed above as
  `gitpilot.*` with `category: "gitpilot"`.
- `contributes.viewsContainers.activitybar`: a single `gitpilot`
  container using `media/activity-bar.png`.
- `contributes.views.gitpilot`: one webview view `gitpilot.panel`
  titled "gitpilot".
- `contributes.menus.scm/title`: surfaces `gitpilot.commit` from the
  Source Control title bar when the active provider is git.
- `contributes.configuration`:
  - `gitpilot.defaultMode`: `"gitpilot" | "native"` (default
    `gitpilot`).
  - `gitpilot.cliCommand`: command used to invoke the CLI (default
    `npx gitpilot`).

## State storage

| State                              | Where                                              |
| ---------------------------------- | -------------------------------------------------- |
| AI on/off mode                     | `context.globalState[gitpilot.mode]`               |
| First-launch flag                  | `context.globalState[gitpilot.firstLaunchComplete]`|
| API keys                           | OS keychain via `keytar` (service: `gitpilot`)     |
| Active provider + model            | `gitpilot.config.yml` (`ai.provider`, `ai.model`)  |
| Open diff tabs                     | `gitpilotSidebarProvider.openedDiffs: Set<string>` (re-derivable from `tabGroups`) |

## Rules

- Extension host never imports CLI modules directly — always shells
  out via `execFile` or a terminal.
- Webview is built separately with Vite, copied into
  `media/webview/`, loaded via `webview.asWebviewUri`.
- CSP locks `script-src` and `style-src` to `webview.cspSource`.
- All `postMessage` traffic is typed and validated at the boundary.
- `runWithStatus(command, fn)` wraps every async handler so the status
  bar, panel `commandRunning`/`commandDone`/`commandFailed` messages,
  and error surfacing are uniform.
- Every CLI exec hydrates env from the keychain — no `.env` files.
- Spec writes go through `vscode.workspace.findFiles` for picking and
  `node:fs/promises.writeFile` for persistence; never via terminal.
- Diff tabs are pinned with `workbench.action.keepEditor` so multiple
  stay open simultaneously.
- Tab-close reconciliation runs on `tabGroups.onDidChangeTabs`; the
  panel highlight is a mirror of editor truth, never a guess.
- API keys are configured inside VS Code (first-launch prompt or
  `gitpilot.auth`), never by asking the user to run `gitpilot auth` in
  a terminal.
- Webview polls `requestState` every 2.5s without gating on
  `document.visibilityState`.

## Tests required

- Palette commands spawn a terminal with the correct CLI invocation.
- `gitpilot.toggleMode` flips `globalState[gitpilot.mode]` and posts
  `modeUpdate` to the webview.
- `switchModel` quick pick shows every entry in `MODEL_OPTIONS` plus
  any model returned by `http://localhost:11434/api/tags`, deduped on
  `provider:model`.
- `switchModel` writes both fields into `gitpilot.config.yml` and
  posts `configUpdate` immediately afterwards.
- `reviewPR` passes `--pr <id>` when a PR number is entered, and runs
  without the flag when the input box is cancelled.
- `requestState` causes the host to broadcast `setupStatus`,
  `modelOptionsUpdate`, `modeUpdate`, `repoStatus`, and
  `openDiffsUpdate` in a single tick.
- `setupStatus` for an Ollama provider with the daemon down resolves
  `aiConfigured: false` within ~1s.
- Webview `generateCommit` causes the host to run `gitpilot commit
  --dry-run` with `process.env` hydrated from the keychain, then post
  `commitDraft` with the parsed message.
- Webview `commitMessage` triggers a `git commit -m "<msg>"` and only
  on success does the host post `commandDone` and a refreshed
  `repoStatus`.
- Webview `generatePr` runs `gitpilot pr create --dry-run` and posts
  `prDraft` with the parsed `{title, description}`.
- Webview `pushBranch` runs `git push -u origin HEAD` in the terminal.
- Webview `runReview` runs `gitpilot review --json` and posts
  `reviewResult` with parsed issues; an empty array emits no UI card.
- Webview `publishReview` runs `gitpilot review --publish` in the
  terminal.
- Webview `openPr` runs `gh pr view --web` in the terminal.
- Webview `openFileDiff { path, staged: true }` calls `vscode.diff`
  with `git:`-scheme URIs at refs `HEAD` and `~` and pins the editor.
  Path is added to `openedDiffs`; `openDiffsUpdate` is broadcast.
- Webview `openFileDiff { path, staged: false }` uses
  `git:`-scheme HEAD on the left and a `file:` working URI on the
  right.
- Webview `closeFileDiff { path }` finds the matching tab via
  `extractDiffPath` (handles both `file:` and `git:` schemes), closes
  it, removes the path from `openedDiffs`, and broadcasts the new
  list.
- Closing a diff tab from the editor side fires
  `tabGroups.onDidChangeTabs`, removes the matching path, and
  broadcasts `openDiffsUpdate`.
- Webview `pickSpecFile` runs `findFiles` with the standard exclusions,
  shows a quick pick, and posts `specFilePicked` only when the user
  selects an entry.
- Webview `generateSpec` calls `callConfiguredAi` with the active
  provider; on success writes `<basename>.spec.md` and posts
  `specGenerated { path, preview }`. With no key configured, falls
  back to `buildHeuristicSpec` and never writes TODO placeholders.
- Webview `openSpec` opens the file with `preview: false`.
- Status bar shows the running indicator while any host action is in
  flight and resets to "ready" afterwards.
- `webviewView.onDidChangeVisibility` triggers an immediate
  `postState` when the panel becomes visible.
