# Module: cli

## Purpose
Entry point for gitflow. Reads gitflow.config.yml, wires all
modules together, registers git hooks, and exposes commands that
developers run from the terminal.

## Dependencies
- core/ai          — createAIProvider
- core/secrets     — createSecrets
- core/git         — createGitClient
- core/confirmation — createConfirmation
- modules/commitGenerator
- modules/prDescription
- modules/prCreator
- modules/prReviewer
- modules/commentFixer
- platforms/github
- platforms/azureDevops

## Commands exposed

### npx gitflow auth
Interactive setup wizard. Prompts for each secret key and
stores them in OS keychain via secrets module.

Prompts:
? Anthropic API key (sk-ant-...): ****
? GitHub token (ghp_...): ****
? Azure DevOps PAT: ****
✓ Secrets stored in OS keychain

### npx gitflow install
Install git hooks into current repo:
- prepare-commit-msg hook → runs commit command
- post-push hook → runs pr command
Writes hooks to .git/hooks/ with chmod +x
Shows success message listing installed hooks.

### npx gitflow commit
Run commitGenerator.run() with config from gitflow.config.yml
Uses mode from config.mode.commit

### npx gitflow pr
Run prCreator.run() which internally runs prDescription
Uses mode from config.mode.pr_create

### npx gitflow review [--pr <id>]
Run prReviewer.run() with optional PR id
If --pr not provided, reviews local diff
Uses mode from config.mode.pr_review

### npx gitflow fix [--pr <id>] [--comment <id>]
Run commentFixer.run()
If --comment not provided, fix all blockers on PR
Uses mode from config.mode.comment_fix

### npx gitflow status
Show current config summary:
- AI provider and model
- Platform (GitHub or Azure DevOps)
- Mode per action
- Whether secrets are stored
- Whether git hooks are installed

## Public API
```ts
export async function main(argv: string[]): Promise<void>
```

## Config loading
```ts
export interface gitflowConfig {
  ai: {
    provider: 'claude' | 'openai' | 'gemini' | 'ollama'
    model: string
    fallback?: string
  }
  platform: {
    type: 'github' | 'azure-devops'
    owner?: string
    repo?: string
    org?: string
    project?: string
    repositoryId?: string
  }
  mode: {
    commit: ConfirmMode
    pr_create: ConfirmMode
    pr_description: ConfirmMode
    pr_review: ConfirmMode
    comment_fix: ConfirmMode
  }
  review: {
    rules: ReviewRule[]
  }
}

export function loadConfig(cwd?: string): gitflowConfig
```

## Wiring — how modules connect
```ts
// Config and secrets
const config = loadConfig()
const secrets = createSecrets()
const ai = createAIProvider({
  provider: config.ai.provider,
  model: config.ai.model,
  secrets
})

// Platform
const platform = config.platform.type === 'github'
  ? createGitHubPlatform({
      owner: config.platform.owner,
      repo: config.platform.repo,
      token: await secrets.get('GITHUB_TOKEN')
    })
  : createAzureDevOpsPlatform({
      org: config.platform.org,
      project: config.platform.project,
      repositoryId: config.platform.repositoryId,
      pat: await secrets.get('AZURE_DEVOPS_PAT')
    })

// Shared modules
const git = createGitClient()
const confirmation = createConfirmation()

// Feature modules wired up
const committer = createCommitGenerator({ ai, git, confirmation,
  mode: config.mode.commit })
const reviewer = createPrReviewer({ ai, git, platform, confirmation,
  mode: config.mode.pr_review, rules: config.review.rules })
```

## Rules
- Parse argv with minimist (lightweight arg parser)
- Load gitflow.config.yml from current working directory
- If no gitflow.config.yml found, throw with helpful message:
  "No gitflow.config.yml found. Run: npx gitflow init"
- Show version with --version flag (read from package.json)
- Show help with --help or unknown command
- All errors caught at top level — print error message and exit 1
- Never show stack traces to end users — only in DEBUG=gitflow mode
- Exit 0 on success, 1 on error, 2 on user cancellation

## Git hook content
### prepare-commit-msg hook
```bash
#!/bin/sh
npx gitflow commit --hook
```

### post-push hook
```bash
#!/bin/sh
npx gitflow pr --hook
```

The --hook flag sets mode to auto so hooks never prompt.

## Error cases
- No gitflow.config.yml → ConfigError with init instruction
- Invalid config values → ConfigError listing invalid fields with zod
- Secret not found for chosen provider → SecretNotFoundError
  pointing to npx gitflow auth
- Unknown command → print help and exit 2
- Module throws → catch, print error.message, exit 1

## Tests required
- loadConfig reads gitflow.config.yml correctly
- loadConfig throws ConfigError when file not found
- loadConfig throws ConfigError on invalid provider value
- commit command runs commitGenerator.run()
- pr command runs prCreator.run()
- review command runs prReviewer.run() with local diff when no --pr
- review --pr 142 passes prId to prReviewer
- fix --pr 142 --comment abc passes both ids to commentFixer
- fix --pr 142 with no --comment fixes all blockers
- auth command prompts for each secret and stores them
- install command writes hooks to .git/hooks/
- status command prints config summary
- --version prints version from package.json
- Unknown command prints help and exits 2
- Top level errors exit 1 with message, no stack trace
- Mocks all modules in tests