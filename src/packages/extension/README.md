# gpilot

AI-powered git workflow inside VS Code. Generate commit messages, create
pull requests with AI descriptions, run AI code reviews, and produce
module specifications — all from a task-oriented sidebar.

The sidebar uses a **transparent background** and VS Code theme tokens,
so it adapts cleanly to any active theme (dark, light, high-contrast).
Most actions shell out to the [`gpilot`](https://www.npmjs.com/package/gpilot)
CLI; spec generation calls the configured AI provider directly using
keys read from the OS keychain.

## Layout

```
┌─────────────────────────────────────────┐
│ ● Ready          AI ▢ ▣   Claude … ▾   │  ← Header
├─────────────────────────────────────────┤
│ Commit  Pull Request  PR Review  Spec MD│  ← Tabs
├─────────────────────────────────────────┤
│                                         │
│            (active tab content)         │
│                                         │
├─────────────────────────────────────────┤
│ ● Anthropic connected     Manage Keys   │  ← Footer (pinned)
└─────────────────────────────────────────┘
```

- **Header** — live status dot, AI on/off toggle, model selector.
- **Tabs** — four equal-width tabs; the active tab gets a blue
  underline.
- **Footer** — provider connection state on the left, **Manage Keys**
  on the right, always pinned to the bottom of the panel.

When AI is **off**, the tabs and content area are dimmed and a
"Enable AI Mode" lock banner is shown above them — every CTA is
non-interactive in this state.

## Tabs

### Commit

- **Generate Commit Message** — runs `gpilot commit --dry-run` and
  drops the suggested Conventional Commit message into an editable
  textarea.
- **Commit** — runs `git commit -m "<edited>"`. The extension never
  auto-commits the AI draft.
- **Staged** / **Changes** sections below the CTA, each collapsible.
  - Rows render like VS Code's SCM view: filename in the primary
    color followed by the dim parent directory that truncates from the
    start (preserving the leaf folder) when the row is too narrow.
  - The checkbox on each row toggles **stage / unstage**.
  - Clicking the row opens the matching diff:
    - **Staged** rows → HEAD ↔ index (`git diff --staged`), opened via
      `vscode.diff` with `git:` URIs on both sides.
    - **Changes** rows → HEAD ↔ working tree, opened via
      `vscode.diff` with a `git:` URI on the left and the file URI on
      the right.
  - Each diff is pinned with `workbench.action.keepEditor` so multiple
    diffs can stay open at once.
  - Clicking the same row again closes that specific diff via
    `vscode.window.tabGroups.close(tab)`.
  - Closing a diff tab in the editor — staged or working — fires
    `tabGroups.onDidChangeTabs`, which clears the row's blue highlight
    in the panel.

### Pull Request

When the current branch isn't pushed yet:

- Branch name + "not pushed" pill.
- **Push Branch** CTA runs `git push -u origin HEAD`.

After push:

- **Generate PR title + description** — runs
  `gpilot pr create --dry-run` and fills two editable fields.
- **Create PR** — opens the PR via `gh pr create`.

### PR Review

Header row matches the Commit and Pull Request tabs —
`⎇ <branch-name> [PR open]  ↗` — the `↗` opens the PR in the browser
via `gh pr view --web`.

Toggle between **Manual** and **Auto** modes:

- **Manual** — `Generate Review` produces a list of issues. Each card
  shows severity (blocker / warning / info), the comment text, and a
  `file:line` reference. **Preview Fix** opens the AI's proposed change
  before applying. **Publish Review →** posts all comments to the
  remote.
- **Auto** — `Generate & Publish Review` runs the review and publishes
  in one step, no preview.

### Spec MD

Generate a module specification for any file in the repo:

1. Pick a file via VS Code's Quick Pick (the picker truncates long
   paths and shows the full path on hover).
2. Choose which sections to include — all four (Purpose, API Surface,
   Usage, Edge cases & errors) are checked by default.
3. Click **Generate spec.md** to produce `<basename>.spec.md` next to
   the source file.
4. The generated file appears inline with an **Open ↗** button.

Spec generation calls your configured AI provider directly:

- **Anthropic** — `https://api.anthropic.com/v1/messages`
- **OpenAI** — `https://api.openai.com/v1/chat/completions`
- **Gemini** — `https://generativelanguage.googleapis.com/v1beta`
- **Ollama** — `http://localhost:11434/api/generate`

If no key is configured, a deterministic structural parse runs as a
fallback so spec generation never silently fails.

## AI mode toggle

The header has an AI on/off toggle:

- **On** — the four tabs are interactive, AI generation is available.
- **Off** — every tab and CTA is locked behind a dim overlay with a
  "Enable AI Mode" banner. The mode is persisted across sessions.

## Model switcher

Pick the active provider + model from the header dropdown. Supports:

- Claude (Sonnet 4.6, Opus 4.7)
- GPT-4o
- Gemini 2.5 Pro / 2.0 Flash
- Any local Ollama model auto-discovered at
  `http://localhost:11434/api/tags`

The selection is written into `gpilot.config.yml`. The dropdown is
width-capped and truncates long labels; the full label is shown on
hover.

## Live Ollama health

When the active provider is Ollama, the extension polls
`http://localhost:11434/api/tags` and updates the footer accordingly:

- **Ollama (local) running** — daemon is reachable.
- **Ollama not running** — daemon is down or unreachable.

Status refreshes every ~2.5 seconds while the panel is open, plus
immediately whenever the panel becomes visible.

## API key management

- **Manage Keys** in the footer (and the **Configure** button on the
  setup screen) opens a quick-pick that writes secrets to the OS
  keychain via `keytar`. No `.env` files, no plaintext, no VS Code
  SecretStorage.
- The setup screen is shown until at least one AI key (skip if using
  Ollama) and one platform token are saved.

## Commands

| Command                                    | What it does                                |
| ------------------------------------------ | ------------------------------------------- |
| `gpilot: Generate commit message`          | Runs `gpilot commit` in a terminal          |
| `gpilot: Create PR with description`       | Runs `gpilot pr` in a terminal              |
| `gpilot: Review current PR`                | Prompts for PR id then runs `gpilot review` |
| `gpilot: Fix all blocker comments`         | Runs `gpilot fix --all`                     |
| `gpilot: Fix selected comment`             | Runs `gpilot fix --pr <id> --comment <id>`  |
| `gpilot: Switch AI model`                  | Quick-pick that updates `gpilot.config.yml` |
| `gpilot: Setup or update API keys`         | Opens the keychain manager                  |
| `gpilot: Show panel`                       | Focuses the sidebar                         |
| `gpilot: Show status`                      | Runs `gpilot status` in a terminal          |
| `gpilot: Toggle between AI and Native Git` | Flips the AI toggle from the palette        |

## Settings

| Setting              | Default      | Description                                   |
| -------------------- | ------------ | --------------------------------------------- |
| `gpilot.defaultMode` | `gpilot`     | `"gpilot"` (AI on) or `"native"` (AI off)     |
| `gpilot.cliCommand`  | `npx gpilot` | Override if `gpilot` is installed differently |

## Requirements

- **Node.js** 24+
- **VS Code** 1.85+
- A git repository in the workspace
- `gh` CLI on `PATH` if you plan to create PRs from the panel
- API keys for whichever AI provider you select (skip if using Ollama)

## Configuration file

The extension expects a `gpilot.config.yml` at the workspace root.
Minimal example:

```yaml
ai:
  provider: claude
  model: claude-sonnet-4-6
platform:
  type: github
  owner: your-org
  repo: your-repo
mode:
  commit: interactive
  pr_create: interactive
  pr_description: auto
  pr_review: auto
  comment_fix: interactive
review:
  rules:
    - id: no-console-logs
      description: No console.log in production code
      severity: warning
    - id: no-hardcoded-secrets
      description: No hardcoded API keys or tokens
      severity: blocker
```

## How it works

The extension host **never** imports CLI modules directly. Each user
action follows one of three paths:

1. **One-shot stdout capture** — `npx gpilot … --dry-run` /
   `--json` for commit, PR draft, review, and status. The extension
   hydrates `process.env` from the keychain before invoking, so the
   CLI sees `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`
   / `GITHUB_TOKEN` etc. without any additional setup.
2. **Direct AI call** — Spec MD generation calls the configured
   provider's HTTP API directly, with a structural fallback when no
   key is available.
3. **Terminal spawn** — when the user should see streaming output or
   answer prompts (palette commands, fix flows, `gh pr create`,
   `git push`).

State storage:

- **Mode** (AI on/off) and **first-launch** flag — `context.globalState`
- **Secrets** — OS keychain via `keytar` (service: `gpilot`)
- **Model selection** — `gpilot.config.yml`
- **Open diff tabs** — tracked via
  `vscode.window.tabGroups.onDidChangeTabs` so the file-row highlight
  in the panel stays in sync with VS Code's editor state.

## License

MIT
