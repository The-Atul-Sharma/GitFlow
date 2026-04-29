# 🚀 gpilot

[![npm version](https://img.shields.io/npm/v/gpilot.svg)](https://www.npmjs.com/package/gpilot)
[![npm downloads](https://img.shields.io/npm/dw/gpilot.svg)](https://www.npmjs.com/package/gpilot)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/your-publisher.gpilot)](https://marketplace.visualstudio.com/items?itemName=your-publisher.gpilot)
[![VS Code Installs](https://img.shields.io/visual-studio-marketplace/i/your-publisher.gpilot)](https://marketplace.visualstudio.com/items?itemName=your-publisher.gpilot)
[![License](https://img.shields.io/npm/l/gpilot)](./LICENSE)

AI-powered **Git workflow automation CLI and VS Code extension**.

> Generate commits → create pull requests → review code → fix issues → write specs — all in one flow.

---

## ✨ Features

### 🖥️ CLI

- ✍️ Generate **conventional commit messages** from staged changes
- 🔀 Create pull requests with **AI-generated titles & descriptions**
- 🔍 Review PRs against configurable rules
- 🛠️ Apply review fixes interactively
- 🧪 Dry-run support for safe previews
- 📊 Repository state detection via `gpilot status`
- 🤖 Pluggable AI providers:
  - OpenAI (GPT)
  - Anthropic (Claude)
  - Google (Gemini)
  - Ollama (local models)
- 🔌 Pluggable platforms:
  - GitHub
  - Azure DevOps
  - GitLab (extensible)
- 🔐 Secure secrets via OS keychain (`keytar`)

---

### 🧩 VS Code Extension

A clean, task-focused sidebar with **four tabs** and a transparent
background that adapts to any VS Code theme (dark, light, high-contrast).

#### 🧭 Header

- Live status indicator (`Ready` / `Running…` / `Setup required` / `Error`)
- **AI on/off toggle** — flip AI mode on or off without leaving the panel.
  When AI is off, every tab and CTA is locked behind an overlay.
- **Model selector** — switch between Claude, GPT-4o, Gemini, or any
  locally installed Ollama model. Selection is written to
  `gpilot.config.yml`.

#### 🛠️ Setup Screen

When credentials are missing, the panel shows a checklist of what's
needed (AI provider key, platform token) and a single **Configure**
button. Configure walks you through saving each key to your **system
keychain** via VS Code prompts — no `.env` files, no plaintext storage.

#### ✍️ Commit Tab

- One-click **Generate Commit Message** (Conventional Commits format)
- Editable textarea with the generated draft
- Full-width **Commit** CTA
- Collapsible **Staged** / **Changes** sections under the CTA
- Each row renders like VS Code's SCM view: `filename.ts` in the
  primary color followed by a dim parent directory that truncates from
  the start when there isn't room
- Checkbox on each row stages / unstages the file
- Click a row to open the matching diff in VS Code:
  - **Staged** rows open the HEAD ↔ index diff (`git diff --staged`)
  - **Changes** rows open the HEAD ↔ working tree diff
- Click the same row again to close that diff. Closing the tab from
  the editor clears the row's highlight automatically.
- Multiple file diffs can stay open simultaneously

#### 🔀 Pull Request Tab

- Branch name + push state pill
- **Push Branch** CTA when the branch hasn't been pushed yet
- After push: **Generate PR Title + Description**, edit, then
  **Create PR**

#### 🔍 PR Review Tab

- Header mirrors the Commit / PR tab: `⎇ branch-name [PR open] ↗`
  with a click-through to open the PR in the browser
- **Manual mode** — generate review, preview each comment, edit before
  publishing
- **Auto mode** — generate and publish in one click
- Comments tagged with severity (🚫 blocker / ⚠️ warning / ℹ️ info),
  with file:line references
- Per-issue **Preview Fix** to inspect the proposed change before
  applying

#### 📄 Spec MD Tab

A new tab for generating module specifications:

- Pick any file from the repo via VS Code's Quick Pick
- Choose which sections to include (Purpose, API Surface, Usage,
  Edge cases & errors)
- Generates `<basename>.spec.md` next to the source file using your
  configured AI provider (with a structural fallback if no AI key is
  configured)

#### 🤖 Live Ollama Detection

If you switch to an Ollama model and the local server stops, the
footer flips to "Ollama not running" within ~2.5s — no manual refresh
needed.

#### 🧭 Commands

- `gpilot: Generate commit message`
- `gpilot: Create PR with description`
- `gpilot: Review current PR`
- `gpilot: Fix all blocker comments`
- `gpilot: Fix selected comment`
- `gpilot: Switch AI model`
- `gpilot: Setup or update API keys`
- `gpilot: Show panel`
- `gpilot: Show status`
- `gpilot: Toggle between AI and Native Git`

#### ⚙️ Settings (`settings.json`)

- `gpilot.defaultMode` — `"gpilot"` or `"native"`
- `gpilot.cliCommand` — override the CLI invocation (default
  `npx gpilot`)

---

## 🧠 How It Works

The VS Code extension runs commit / PR / review actions via:

```bash
gpilot ...
```

This ensures:

- Consistent CLI + extension behavior
- No duplicated logic
- Easier maintenance

Spec generation calls the configured AI provider directly (Anthropic /
OpenAI / Gemini / Ollama) using keys read from the OS keychain.

---

## 📦 Requirements

- Node.js >= 18
- A Git repository
- API keys for selected providers
- VS Code >= 1.85

---

## 📥 Installation

### 🖥️ CLI

```bash
npm install -g gpilot
```

Verify:

```bash
gpilot --help
```

### 🧩 VS Code Extension

Install from **VS Code Marketplace**:

1. Open Extensions (`Cmd/Ctrl + Shift + X`)
2. Search for **gpilot**
3. Click **Install**

---

## ⚙️ Configuration

### 🌱 Environment Variables

```bash
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
GITHUB_TOKEN=
AZURE_DEVOPS_PAT=
AZURE_DEVOPS_ORG=
AZURE_DEVOPS_PROJECT=
GITLAB_TOKEN=
```

---

### 🔐 Secure Storage

API keys are stored in your **OS keychain** (macOS Keychain, Windows
Credential Manager, libsecret on Linux) via `keytar`:

- Used during extension onboarding
- Managed via: `gpilot: Setup or update API keys` or the **Manage
  Keys** button in the panel footer

---

### 🧾 gpilot.config.yml

Controls:

- AI provider and model
- Git platform
- Interaction mode (`interactive` / `auto`)
- Review rules

---

## 🚀 Usage

### CLI

```bash
gpilot commit --dry-run
gpilot commit

gpilot pr create --dry-run
gpilot pr create

gpilot pr review
gpilot fix

gpilot status
```

---

### VS Code Extension

1. Click the **gpilot** icon in the activity bar
2. If credentials are missing, click **Configure** to save them to your
   system keychain
3. Use the four tabs:
   - **Commit** — generate a message, stage files, commit
   - **Pull Request** — push branch, generate title/description,
     create PR
   - **PR Review** — generate review (manual or auto), publish to remote
   - **Spec MD** — pick a file, generate a spec.md next to it

---

## 🧱 Project Structure

```bash
src/
  cli/          CLI entry
  core/         AI, git, secrets, utilities
  modules/      commit, PR, review, fix
  platforms/    Git providers
  packages/
    extension/  VS Code extension host
    webview/    React UI for the sidebar (transparent, theme-aware)
```

---

## 🧪 Local Development & Testing

### 🧩 Package and Install Extension Locally

To package and install the VS Code extension locally:

```bash
cd src/packages/extension
npm run build                    # builds webview + extension
npx @vscode/vsce package         # produces gpilot-<version>.vsix
code --install-extension gpilot-{version}.vsix
```

After installation:

- Reload VS Code
- Click the **gpilot** icon in the activity bar to open the panel

---

### 🖥️ CLI Local Testing

To test the CLI locally during development:

```bash
npm install
npm run build
npm link
```

---

### 🧪 Debug Extension

1. Open `src/packages/extension` in VS Code
2. Press `F5`
3. Test in Extension Development Host

---

## 🔍 Keywords

AI git workflow, commit message generator, AI PR generator, AI code
review, spec.md generator, git automation CLI, VS Code git assistant,
developer productivity

---

## 📄 License

MIT
