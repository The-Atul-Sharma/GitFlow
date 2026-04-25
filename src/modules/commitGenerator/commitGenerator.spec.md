# Module: commitGenerator

## Purpose
Read git staged diff and generate a conventional commit message using
the configured AI provider. Show the message to the user, let them
accept, edit, regenerate, or cancel.

## Dependencies
- core/ai          — AI provider for generating the message
- core/git         — read staged diff and recent commits
- core/confirmation — interactive y/n/edit/regenerate prompt

## Public API
```ts
export interface CommitGeneratorInput {
  ai: AIProvider
  git: GitClient
  confirmation: Confirmation
  mode: ConfirmMode
}

export interface CommitGeneratorResult {
  status: 'committed' | 'cancelled' | 'dryrun'
  message?: string
}

export function createCommitGenerator(
  input: CommitGeneratorInput
): {
  run(): Promise<CommitGeneratorResult>
}
```

## Flow
1. Read staged diff from git client
2. If diff is empty, throw CommitGenerationError "No staged changes.
   Run git add first."
3. Read last 5 commit messages for style context
4. Build prompt for AI with diff + recent commits
5. Get message from AI provider
6. Validate generated message format (see Rules)
7. Show preview via confirmation module
8. Handle user response:
   - yes        → write message via git.setCommitMessage, return committed
   - edit       → use edited text instead, write via git.setCommitMessage
   - regenerate → loop back to step 4
   - no         → return cancelled

## Prompt for AI