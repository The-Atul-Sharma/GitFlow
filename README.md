# gitflow

CLI tool that automates git workflow, commit messages, PR creation, PR
descriptions, and PR reviews using configurable AI providers.

## Features

- Generate conventional-commit messages from staged changes
- Create pull requests with AI-written titles and descriptions
- Review PRs against a configurable rule set
- Apply review-comment fixes interactively
- Pluggable AI providers (Anthropic, OpenAI, Gemini, Ollama fallback)
- Pluggable git platforms (GitHub, Azure DevOps)
- Secrets stored in the OS keychain via `keytar`

## Requirements

- Node.js >= 24
- A git repository
- API keys for the providers you intend to use

## Installation

```bash
npm install
npm run build
npm link    # exposes the `gitflow` binary globally
```

For local development without linking:

```bash
npm run dev -- <command>
```

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

Secrets can also be stored in the OS keychain instead of `.env`.

### `gitflow.config.yml`

Project-level configuration lives in `gitflow.config.yml` at the repo
root. It controls the AI provider, target platform, interaction mode for
each command, and review rules. See the file in this repo for a working
example.

## Usage

```bash
gitflow commit              # generate and create a commit from staged changes
gitflow pr create           # open a pull request for the current branch
gitflow pr describe         # write or refresh a PR description
gitflow pr review <number>  # run an AI review against the configured rules
gitflow fix                 # apply review-comment fixes interactively
```

Each command honours the `mode` setting (`interactive` or `auto`) from
`gitflow.config.yml`.

## Project layout

```
src/
  cli/          entry point
  core/         ai, git, secrets, confirmation
  modules/      commitGenerator, prCreator, prDescription, prReviewer, commentFixer
  platforms/    github, azureDevops
  packages/     extension (VS Code), webview (sidebar UI)
```

Module specs live alongside the code in `*.spec.md` files; the
high-level architecture spec is in `specs/architecture.spec.md`.

## Development

```bash
npm run dev      # run the CLI from source via tsx
npm run build    # compile TypeScript to dist/
npm test         # run vitest
```

## License

MIT
