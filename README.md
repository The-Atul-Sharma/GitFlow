# gitflow

CLI tool **and VS Code extension** that automates the git workflow — commit
messages, PR creation, PR descriptions, and PR reviews — using configurable
AI providers.

## Features

### CLI

- Generate conventional-commit messages from staged changes
- Create pull requests with AI-written titles and descriptions
- Review PRs against a configurable rule set
- Apply review-comment fixes interactively
- Pluggable AI providers (Anthropic, OpenAI, Gemini, Ollama fallback)
- Pluggable git platforms (GitHub, Azure DevOps, GitLab)
- Secrets stored in the OS keychain via `keytar`

### VS Code extension

- Activity-bar entry with a sidebar **gitflow panel** (React webview)
- Pipeline view showing live status of each step (commit → PR → description
  → review → fix)
- Review-comment list with severity badges and one-click **Fix** / **Dismiss**
  actions
- **Model switcher** — pick between Claude, GPT, Gemini, or any locally
  installed Ollama model; updates `gitflow.config.yml` automatically
- **Status bar** indicator (`gitflow ready` / `running…` / `N blockers`)
  that focuses the panel on click
- First-launch onboarding that prompts for the AI and platform keys it
  needs and stores them in the OS keychain
- Command palette entries:
  - `gitflow: Generate commit message`
  - `gitflow: Create PR with description`
  - `gitflow: Review current PR`
  - `gitflow: Fix all blocker comments`
  - `gitflow: Fix selected comment`
  - `gitflow: Switch AI model`
  - `gitflow: Setup or update API keys`
  - `gitflow: Show gitflow panel`
  - `gitflow: Show status`

The extension never imports the CLI directly — every action shells out to
`npx gitflow …` in a dedicated terminal, so behavior stays identical to
the CLI.

## Requirements

- Node.js >= 24
- A git repository
- API keys for the providers you intend to use
- VS Code >= 1.85 (only if you want the extension)

## Installation

### CLI

```bash
npm install
npm run build
npm link    # exposes the `gitflow` binary globally
```

For local development without linking:

```bash
npm run dev -- <command>
```

### VS Code extension

A pre-built `gitflow-1.0.0.vsix` ships in `src/packages/extension/`. Install
it with:

```bash
code --install-extension src/packages/extension/gitflow-1.0.0.vsix
```

Or, in VS Code: **Extensions → … menu → Install from VSIX…** and pick the
file.

## Configuration

### Environment variables

Copy `.env.example` to `.env` and fill in the keys you need:

```
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GITHUB_TOKEN=
AZURE_DEVOPS_PAT=
AZURE_DEVOPS_ORG=
AZURE_DEVOPS_PROJECT=
```

Secrets can also be stored in the OS keychain instead of `.env`. The
extension's first-launch flow and `gitflow: Setup or update API keys`
command both write to the keychain under the `gitflow` service.

### `gitflow.config.yml`

Project-level configuration lives in `gitflow.config.yml` at the repo
root. It controls the AI provider, target platform, interaction mode for
each command, and review rules. The extension's **Switch AI model** action
edits the `ai.provider` / `ai.model` fields in this file. See the file in
this repo for a working example.

## Usage

### CLI

```bash
gitflow commit              # generate and create a commit from staged changes
gitflow pr create           # open a pull request for the current branch
gitflow pr describe         # write or refresh a PR description
gitflow pr review <number>  # run an AI review against the configured rules
gitflow fix                 # apply review-comment fixes interactively
```

Each command honours the `mode` setting (`interactive` or `auto`) from
`gitflow.config.yml`.

### VS Code extension

1. Click the **gitflow** icon in the activity bar to open the side panel.
2. On first launch, the extension prompts for at least one AI key and one
   platform token. Pick **Set up keys** to walk through the flow.
3. Use the panel buttons or the command palette (`Cmd/Ctrl + Shift + P`,
   then type `gitflow:`) to run any action.
4. The status bar item reflects pipeline progress. After a review, it
   shows the blocker count — click it to focus the panel.

## Project layout

```
src/
  cli/          entry point
  core/         ai, git, secrets, confirmation
  modules/      commitGenerator, prCreator, prDescription, prReviewer, commentFixer
  platforms/    github, azureDevops
  packages/
    extension/  VS Code extension (extension host)
    webview/    React + Vite sidebar UI
```

Module specs live alongside the code in `*.spec.md` files; the high-level
architecture spec is in `specs/architecture.spec.md`.

## Development

### Root CLI

```bash
npm run dev      # run the CLI from source via tsx
npm run build    # compile TypeScript to dist/
npm test         # run vitest
```

### VS Code extension — building and testing locally

The extension's `npm run build` script does everything in one go: it
builds the React webview, copies the bundle into `media/webview/`, and
compiles the extension's TypeScript to `dist/`.

```bash
# 1. Install dependencies for both packages
cd src/packages/webview     && npm install
cd ../extension             && npm install

# 2. Build (builds webview, copies it, then compiles the extension)
npm run build               # from src/packages/extension
```

To package and install the extension locally for testing:

```bash
cd src/packages/extension
npx @vscode/vsce package                       # produces gitflow-<version>.vsix
code --install-extension gitflow-1.0.0.vsix    # install into VS Code
```

After installation, reload VS Code and click the **gitflow** icon in the
activity bar to use it.

For iterative work, you can also debug the extension without packaging:

1. Open the **`src/packages/extension`** folder in a fresh VS Code window
   (so the bundled `.vscode/launch.json` is picked up).
2. Press `F5` (or **Run → Start Debugging**). This launches an
   **Extension Development Host** with the freshly built extension loaded.
3. In the dev host, open any git repository, click the gitflow activity-bar
   icon, and exercise the panel.

After making changes, re-run `npm run build` and reload the Extension
Development Host (`Cmd/Ctrl + R`) to pick up the new bundle.

## License

MIT
