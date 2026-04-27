# Module: vscode-extension

## Purpose
Expose all gitflow commands inside VS Code via the command palette,
sidebar panel, and source control context menus. Developers never need
to open a terminal — everything works from inside VS Code.

## Two parts
1. extension host (packages/extension/src/extension.ts)
   Pure TypeScript, talks to VS Code API, calls CLI via child_process
2. webview panel (packages/webview/src/)
   React + Vite, compiled to single HTML file, shows pipeline status
   and review comments visually

## Commands registered (command palette via Cmd+Shift+P)

| Command ID                        | Label                              |
|-----------------------------------|------------------------------------|
| gitflow.commit                 | gitflow: Generate commit message |
| gitflow.createPR               | gitflow: Create PR with description |
| gitflow.reviewPR               | gitflow: Review current PR      |
| gitflow.fixAllBlockers         | gitflow: Fix all blocker comments |
| gitflow.fixComment             | gitflow: Fix selected comment   |
| gitflow.generateSpec           | gitflow: Generate spec for active file |
| gitflow.generateClaudeMd       | gitflow: Generate CLAUDE.md     |
| gitflow.switchModel            | gitflow: Switch AI model        |
| gitflow.auth                   | gitflow: Setup or update API keys |
| gitflow.showPanel              | gitflow: Show gitflow panel  |
| gitflow.status                 | gitflow: Show status            |

## Sidebar panel
Registers a WebviewViewProvider in the VS Code sidebar showing:

### Pipeline section
Shows each step with status indicator:
- ○ idle (gray dot)
- ● running (blue dot, animated)
- ✓ done (green dot)
- ✗ failed (red dot)

Steps shown:
1. Commit message
2. PR created
3. PR description
4. PR review
5. Fix comments

### Review comments section
When a PR has been reviewed, shows each issue as a card:
- Severity badge (blocker/warning/info)
- File path and line number
- Comment text
- "Fix with gitflow" button
- "Dismiss" button

### Spec tools section
- "Generate CLAUDE.md" button
- "Generate spec for active file" button
- "Generate spec for existing component" button

### Model switcher section
Dropdown showing current provider + model.
Options:
- Claude Sonnet 4.6 (default)
- Claude Opus 4.6
- GPT-4o
- Gemini 1.5 Pro
- Ollama (local)

Changing selection runs:
npx gitflow config set ai.provider <provider> ai.model <model>

## Extension host implementation

### How commands work
Each command spawns a terminal and runs the CLI:

```ts
async function runCommand(command: string, args: string[] = []) {
  const terminal = vscode.window.createTerminal('gitflow')
  terminal.show()
  terminal.sendText(`npx gitflow ${command} ${args.join(' ')}`)
}

vscode.commands.registerCommand('gitflow.commit', () =>
  runCommand('commit')
)

vscode.commands.registerCommand('gitflow.createPR', () =>
  runCommand('pr')
)

vscode.commands.registerCommand('gitflow.reviewPR', async () => {
  const prId = await vscode.window.showInputBox({
    prompt: 'PR number (leave empty for local diff review)',
    placeHolder: '142'
  })
  runCommand('review', prId ? ['--pr', prId] : [])
})

vscode.commands.registerCommand('gitflow.switchModel', async () => {
  const model = await vscode.window.showQuickPick([
    { label: 'Claude Sonnet 4.6', detail: 'Fast and smart — recommended', 
      provider: 'claude', model: 'claude-sonnet-4-6' },
    { label: 'Claude Opus 4.6', detail: 'Most capable, slower',
      provider: 'claude', model: 'claude-opus-4-6' },
    { label: 'GPT-4o', detail: 'OpenAI — requires OPENAI_API_KEY',
      provider: 'openai', model: 'gpt-4o' },
    { label: 'Gemini 1.5 Pro', detail: 'Google — requires GEMINI_API_KEY',
      provider: 'gemini', model: 'gemini-1.5-pro' },
    { label: 'Ollama (local)', detail: 'Free, runs on your machine',
      provider: 'ollama', model: 'llama3' },
  ], { placeHolder: 'Select AI model' })

  if (model) {
    runCommand('config set', [
      `ai.provider ${model.provider}`,
      `ai.model ${model.model}`
    ])
    vscode.window.showInformationMessage(
      `gitflow: Switched to ${model.label}`
    )
  }
})
```

### How the webview communicates with extension host

```ts
// Extension host sends data to webview
panel.webview.postMessage({
  type: 'reviewComplete',
  issues: [
    { file: 'src/auth.ts', line: 42, severity: 'blocker', comment: '...' }
  ]
})

// Webview sends actions back to extension host
window.addEventListener('message', event => {
  const message = event.data
  switch (message.type) {
    case 'fixComment':
      runCommand('fix', ['--pr', message.prId, '--comment', message.commentId])
      break
    case 'switchModel':
      runCommand('config set', [`ai.model ${message.model}`])
      break
  }
})
```

### Status bar item
Shows at the bottom of VS Code:
- "$(sync~spin) gitflow running..." during command execution
- "$(check) gitflow ready" when idle
- "$(alert) 3 blockers" when review found issues
- Clicking opens the sidebar panel

## Webview React component structure
  packages/webview/src/
  App.tsx                  ← root, receives messages from extension
  components/
  PipelineStatus.tsx     ← shows each step with dot indicator
  ReviewCard.tsx         ← one issue card with fix button
  ReviewCommentList.tsx  ← list of all review cards
  ModelSwitcher.tsx      ← dropdown for AI model selection
  SpecTools.tsx          ← generate spec/CLAUDE.md buttons
  hooks/
  useVSCodeMessages.ts   ← listens for postMessage from extension

  ## package.json for extension
```json
{
  "name": "gitflow-vscode",
  "displayName": "gitflow",
  "description": "AI-powered git workflow automation",
  "version": "0.1.0",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Other"],
  "activationEvents": ["onStartupFinished"],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [...],
    "viewsContainers": {
      "activitybar": [{
        "id": "gitflow",
        "title": "gitflow",
        "icon": "$(source-control)"
      }]
    },
    "views": {
      "gitflow": [{
        "type": "webview",
        "id": "gitflow.panel",
        "name": "gitflow"
      }]
    }
  }
}
```

## API key management

Inside VS Code the user never runs `gitflow auth`. The extension owns the
secret-setup UX:

- On first activation per VS Code profile, the extension prompts the user
  to set up API keys. A `gitflow.firstLaunchComplete` flag in
  `context.globalState` ensures this runs once.
- The `gitflow.auth` command opens the same flow and can be re-run any
  time to set, update, or clear keys.
- Keys are written to the OS keychain via `keytar` under the service name
  `gitflow`, using the same account names (`ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GITHUB_TOKEN`, `AZURE_DEVOPS_PAT`,
  `GITLAB_TOKEN`) that `core/secrets` reads. CLI subprocesses spawned
  from the extension's terminal therefore see the keys without any
  additional config.
- Prompts use `vscode.window.showInputBox({ password: true })` so values
  never appear in the terminal or output channels.

## Rules
- Extension host never imports CLI modules directly — always spawns process
- Webview built separately with Vite, loaded as compiled HTML
- Extension activates on startup (onStartupFinished)
- All commands available in command palette
- Status bar always visible when extension active
- Model switcher reads current model from gitflow.config.yml on open
- Fix button in webview passes exact commentId to CLI
- API keys are configured inside VS Code (first-launch prompt or
  `gitflow.auth`), never by asking the user to run `gitflow auth` in a
  terminal

## Tests required
- Each command spawns terminal with correct CLI command
- switchModel quick pick shows all five options
- switchModel runs config set with correct provider and model
- reviewPR passes --pr flag when PR number entered
- reviewPR runs without --pr when input box cancelled
- Webview postMessage fixComment triggers fix command
- Status bar shows running during command execution
- Status bar shows blocker count after review