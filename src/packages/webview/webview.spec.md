# Module: webview

## Purpose

React + Vite sidebar panel rendered inside VS Code as a webview view.
Presents a four-tab task UI (Commit / Pull Request / PR Review /
Spec MD) plus a header (status, AI toggle, model selector) and a
pinned footer (provider connection, Manage Keys). Communicates with
the extension host via `postMessage`.

The panel uses a transparent background and VS Code CSS theme tokens
throughout, so it adapts to dark, light, and high-contrast themes
without visual changes.

## Tech stack

- React 18 + TypeScript (strict, ESM)
- Vite (builds to `dist/assets/index.js`, copied into the extension's
  `media/webview/`)
- Inline style objects only — no CSS files, no Tailwind, no UI libs
- VS Code CSS variables + `color-mix(...)` for theme-aware tinting
- `zod` for runtime validation of every inbound and outbound message

## VS Code CSS variables consumed

Resolved at render time via `var(--…)` references in `styles.ts`:

- `--vscode-foreground` (main text + tinted surfaces via `color-mix`)
- `--vscode-descriptionForeground` (muted text)
- `--vscode-input-background` / `--vscode-input-foreground`
- `--vscode-button-background` / `--vscode-button-foreground` (only as
  a fallback — the primary CTA accent is hardcoded `#007acc` so the
  toggle / accent buttons stay blue regardless of theme)
- `--vscode-focusBorder`
- `--vscode-errorForeground`, `--vscode-editorWarning-foreground`
- `--vscode-charts-blue`, `--vscode-charts-orange`, `--vscode-charts-green`
- `--vscode-testing-iconPassed`
- `--vscode-list-hoverBackground`
- `--vscode-font-family`, `--vscode-editor-font-family`

## Layout

```
┌─────────────────────────────────────────┐
│ ● Ready          AI ▢ ▣   Claude … ▾   │  Header (fixed)
├─────────────────────────────────────────┤
│ Commit  Pull Request  PR Review  Spec MD│  Tabs
├─────────────────────────────────────────┤
│              (active tab)               │  Scrollable content
├─────────────────────────────────────────┤
│ ● Anthropic connected     Manage Keys   │  Footer (fixed)
└─────────────────────────────────────────┘
```

When AI is off, tabs and content are dimmed (`opacity: 0.32`,
`pointerEvents: none`) and an opaque "Enable AI Mode" lock banner sits
above the dimmed content. Header and footer stay fully interactive so
the user can flip AI back on.

When the panel needs configuration, the Tabs/Content/AiOffBanner layer
is replaced with the `SetupScreen` component (single Configure CTA,
status checklist, no input fields).

## Component tree

```
App
├── Header                  (status, AI toggle, model select)
├── Tabs                    (4 tabs, active underline)
├── AiOffBanner             (only when locked)
├── (active panel)
│   ├── CommitPanel
│   │   └── FilesSection
│   │       └── FileRow*    (memoized, hoisted)
│   ├── PrPanel
│   │   └── BranchPill
│   ├── ReviewPanel
│   │   └── BranchPill
│   └── SpecPanel
├── SetupScreen             (when needsSetup)
└── Footer                  (provider status, Manage Keys)
```

## Tabs

### Commit

- **Generate Commit Message** — full-width default-style button, sends
  `generateCommit`.
- Editable textarea (mono font) with the current draft.
- Full-width **Commit** primary-blue CTA — disabled while empty or
  while a command is in flight, sends `commitMessage`.
- `FilesSection` below the CTA:
  - Two collapsible groups (`Staged` / `Changes`), default-open. Each
    header is a `<button>` with a rotating caret.
  - Rows are split into two side-by-side `<button>`s — checkbox left,
    filename + dim parent right — to avoid nested clickables that lose
    events.
  - Filename rendered in `c.text` (active) / `c.textMuted` (inactive),
    parent directory in `c.textSubtle` with `direction: rtl` ellipsis
    so the leaf folder stays visible.
  - Checkbox click toggles stage / unstage (`stageFile` /
    `unstageFile`); row click sends `openFileDiff` with `staged: true`
    when in the Staged group, `false` in the Changes group.
  - If the row is already in `openedDiffs`, the click sends
    `closeFileDiff` instead. `openedDiffs` is mirrored from the
    extension via `openDiffsUpdate`.
  - The active row gets a faint blue background (`#007acc 20%`) and a
    trailing dot indicator.

### Pull Request

- Branch row: `⎇ <branch> [pushed|not pushed|PR open]` using
  `BranchPill`.
- If branch is unpushed: descriptive line + full-width **Push Branch**
  CTA (`pushBranch`).
- If branch is pushed: **Generate PR Title + Description**
  (`generatePr`), title input, description textarea (mono), full-width
  **Create PR** primary-blue CTA (`createPr`).

### PR Review

- Branch row identical in shape to Commit / PR tabs:
  `⎇ <branch> [PR open] ↗`. The `↗` sends `openPr` (extension runs
  `gh pr view --web`).
- **Manual / Auto** mode toggle (local React state — not persisted).
  Manual previews comments before publish; Auto runs review and
  publishes in one click.
- **Generate Review** (Manual) or **Generate & Publish Review** (Auto)
  full-width default CTA.
- Issue cards: severity pill + comment + `file:line` + per-issue
  **Preview Fix** action (Manual mode only).
- **Publish Review →** primary-blue CTA at the bottom (Manual mode).

### Spec MD

- File picker button — full-width, mono font, truncated to one line
  with title attribute showing the full path. Click sends
  `pickSpecFile`; extension responds with `specFilePicked { path }`.
- Output preview row showing `<basename>.spec.md`.
- Section checkboxes (all four checked by default): Purpose, API
  Surface, Usage, Edge cases & errors.
- **Generate spec.md** primary-blue CTA — disabled until a file is
  picked. Sends `generateSpec { path, sections }`.
- After generation, an inline preview card with a code-fenced block of
  the generated content and an **Open ↗** button (`openSpec { path }`).

## Setup screen

Shown whenever `aiOn && !ready`. Contains:

- A circular icon (key / bolt / hex) with theme-tinted background.
- Headline ("Setup required" / "Almost ready" / "Setup Ollama")
  derived from which credentials are missing.
- Status checklist (`StatusRow`) with check / cross marks.
- Single full-width **Configure** primary-blue CTA — sends
  `setupKeys`. The extension opens VS Code's QuickPick + InputBox to
  capture each missing secret and writes it to the OS keychain.
- For Ollama provider: only the platform token row is shown.

No input fields ever live inside the webview — all secret entry runs
through native VS Code prompts.

## Header

- Status dot + label: `Ready` / `Running…` / `Error` / `Setup
required`.
- AI on/off toggle (hardcoded blue when on).
- Model selector — `<select>` capped at `max-width: 130px` with native
  `text-overflow: ellipsis`. Full label visible in `title=` tooltip.

## Footer

- Status dot (green when `aiConfigured`, red otherwise).
- Provider label: `Anthropic connected` / `OpenAI connected` /
  `Gemini connected` / `Ollama (local) running` /
  `Ollama not running` / `Not connected`.
- Plain-text **Manage Keys** button on the right — sends `setupKeys`.

## Polling

`App` runs `setInterval(requestState, 2500)` — never gated on
`document.visibilityState` (WebviewView reports `hidden` when the
sidebar is on a different view, which would freeze status updates).
This keeps the Ollama footer indicator and other live state fresh
within ~2.5s.

It also calls `requestState` on `window.focus` and
`document.visibilitychange`.

## Message protocol

All payloads validated with `zod` discriminated unions. Schemas live
in `src/types.ts`.

### Extension → webview (`ExtensionMessage`)

| Type                 | Payload                                                         |
| -------------------- | --------------------------------------------------------------- |
| `configUpdate`       | `{ provider, model }` — current model selection                 |
| `modelOptionsUpdate` | `{ models: ModelEntry[] }` — full picker list                   |
| `commandRunning`     | `{ command }` — turns on header spinner / disables CTAs         |
| `commandDone`        | `{ command }`                                                   |
| `commandFailed`      | `{ command, error }` — shown in red error banner                |
| `setupStatus`        | `{ aiConfigured, platformConfigured, ready }`                   |
| `commitDraft`        | `{ message }`                                                   |
| `prDraft`            | `{ title, description }`                                        |
| `reviewResult`       | `{ issues: InlineIssue[] }`                                     |
| `repoStatus`         | `{ status: RepoStatus }`                                        |
| `modeUpdate`         | `{ mode: "gpilot" \| "native" }` — drives AI on/off toggle      |
| `specFilePicked`     | `{ path }` — set after extension shows QuickPick                |
| `specGenerated`      | `{ path, preview }` — written file + body for inline display    |
| `openDiffsUpdate`    | `{ paths: string[] }` — full set of diff tabs the host has open |

### Webview → extension (`WebviewMessage`)

| Type              | Payload                                                         |
| ----------------- | --------------------------------------------------------------- |
| `requestState`    | (none) — full state refresh                                     |
| `refreshStatus`   | (none) — repo status only                                       |
| `setupKeys`       | (none) — open keychain manager                                  |
| `switchModel`     | `{ provider, model }`                                           |
| `setMode`         | `{ mode }` — toggles AI on/off                                  |
| `generateCommit`  | (none)                                                          |
| `commitMessage`   | `{ message }`                                                   |
| `generatePr`      | (none)                                                          |
| `createPr`        | `{ title, description }`                                        |
| `pushBranch`      | (none) — `git push -u origin HEAD`                              |
| `runReview`       | (none)                                                          |
| `publishReview`   | (none) — `gpilot review --publish`                              |
| `openPr`          | (none) — `gh pr view --web`                                     |
| `previewFix`      | `{ issueId }`                                                   |
| `applyFix`        | `{ issueId }`                                                   |
| `openWorkingTree` | (none)                                                          |
| `openFileDiff`    | `{ path, staged }` — staged decides HEAD↔index vs HEAD↔worktree |
| `closeFileDiff`   | `{ path }`                                                      |
| `stageFile`       | `{ path }`                                                      |
| `unstageFile`     | `{ path }`                                                      |
| `pickSpecFile`    | (none)                                                          |
| `generateSpec`    | `{ path, sections: string[] }`                                  |
| `openSpec`        | `{ path }`                                                      |

## Data types

```ts
interface InlineIssue {
  id: string;
  file: string;
  line: number;
  severity: "blocker" | "warning" | "info";
  comment: string;
  suggestedFix?: string;
}

interface ModelEntry {
  label: string;
  provider: string;
  model: string;
}

interface RepoStatus {
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

type gpilotMode = "gpilot" | "native";
```

## Styling rules

- Base: `body`, `#root`, `layout.shell` all `background: transparent`.
- Surfaces: `color-mix(in srgb, var(--vscode-foreground) N%, transparent)`
  with N ∈ {5, 8, 12, 22} for surface / surface2 / border / border2.
- Accent: hardcoded `#007acc` for the AI toggle, primary CTAs,
  Conventional-Commit branch labels, and active-row highlight (so the
  brand color stays consistent across themes).
- Text: `var(--vscode-foreground)` for primary, `--vscode-descriptionForeground`
  for muted, `color-mix(... 40% transparent)` for subtle.
- Severity: `--vscode-errorForeground`, `--vscode-editorWarning-foreground`,
  `--vscode-charts-blue`.
- Cards: 6px border-radius, `1px solid border` from the surface tokens.
- Section titles: 9.5px uppercase + 0.07em letter-spacing.
- Buttons: 28px height default, 30–34px for primary CTAs.
- Pulse keyframe `gp-pulse` (1.4s, ease-in-out) injected by `main.tsx`
  for skeleton loaders.

## File / module layout

```
src/
  App.tsx                 root, all message dispatch + state
  main.tsx                root render + global styles + pulse keyframe
  styles.ts               c.* tokens, btnStyle, layout, severityPillStyle
  types.ts                zod schemas + inferred types
  vsCodeApi.ts            sendMessage helper around postMessage
  components/
    Header.tsx
    Tabs.tsx
    Footer.tsx
    AiOffBanner.tsx
    SetupScreen.tsx
    CommitPanel.tsx
    PrPanel.tsx
    ReviewPanel.tsx
    SpecPanel.tsx
    FilesSection.tsx      (FileRow hoisted + memoized)
    BranchPill.tsx        (shared by PrPanel + ReviewPanel)
```

## Rules

- `acquireVsCodeApi()` is called once in `vsCodeApi.ts`; nothing else
  in the codebase calls `postMessage` directly.
- Every outbound message goes through the typed `sendMessage()`
  helper, which validates with `webviewMessageSchema.parse()` before
  posting.
- All inbound message handling lives in `App.handleExtensionMessage`.
  Components only receive props + callbacks.
- No nested clickable elements — checkbox and row label are siblings
  inside `FileRow`, each its own `<button>`. `FileRow` is hoisted to
  module scope and wrapped in `React.memo` so React doesn't remount it
  on every parent render (which previously ate the first click).
- All `useCallback` handlers in `FileRow` close over only stable
  primitives so memoization isn't defeated.
- No external CSS / fonts / icons. Codicon font may be loaded via the
  extension if available.
- Vite config sets `base: './'` and `rollupOptions.output.entryFileNames =
'assets/[name].js'` for predictable webview asset paths.
- Setup screen never shows input fields — secret entry is delegated to
  VS Code prompts.
- Tabs are disabled (greyed, `pointer-events: none`) only when
  `locked` (AI off); visibility doesn't depend on repo state anymore.

## Tests required

- App renders Header / Tabs / Footer skeleton when ready.
- `setupStatus { ready: false }` swaps Tabs+Content for SetupScreen.
- `modeUpdate { mode: "native" }` puts the panel in locked state with
  the AiOffBanner above dimmed content.
- AI toggle in Header sends `setMode` with the flipped value.
- `commitDraft` updates the textarea; the Commit CTA stays disabled
  while the draft is empty or `runningCommand === "commit"`.
- Clicking a `FileRow` checkbox sends `stageFile` (or `unstageFile` if
  already staged) and never triggers `openFileDiff`.
- Clicking a `FileRow` body sends `openFileDiff { path, staged }` with
  `staged` matching the group the row appears in.
- Clicking the same `FileRow` while `openedDiffs` contains it sends
  `closeFileDiff` instead.
- `openDiffsUpdate` updates `openedDiffs` and re-renders the active
  highlight on every matching row.
- PR Review panel renders the branch row identically to the PR panel
  (`⎇ <branch> [PR open] ↗`).
- `pickSpecFile` → `specFilePicked` populates the picker button with
  the chosen path; the picker truncates to one line with a title
  tooltip.
- All four spec checkboxes start checked.
- `generateSpec` is sent with `path` plus the array of currently
  checked section keys.
- ModelSwitcher sends `switchModel` with the JSON-encoded provider +
  model parsed back to two strings.
- `requestState` fires every 2.5s without depending on
  `document.visibilityState`.
- Inbound payloads with the wrong shape are dropped silently
  (zod `safeParse(false)` → no state mutation).
