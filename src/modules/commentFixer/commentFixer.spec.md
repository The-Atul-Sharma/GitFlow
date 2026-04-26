# Module: commentFixer

## Purpose
Read a PR review comment and automatically apply the suggested fix
to the correct file and line. Commit and push the fix so the PR
is updated without the developer writing any code.

## Dependencies
- core/ai          — understand the comment and generate the fix
- core/git         — read file, write fix, commit, push
- core/confirmation — confirm before applying and committing
- platforms (interface) — getComment, resolveComment

## Public API
```ts
export interface PRComment {
  id: string
  file: string
  line: number
  body: string
  severity?: 'blocker' | 'warning' | 'info'
  suggestedFix?: string
}

// Adds to GitPlatform interface
export interface GitPlatform {
  // ...existing methods
  getPRComments(prId: string): Promise<PRComment[]>
  resolveComment(prId: string, commentId: string): Promise<void>
}

export interface CommentFixerInput {
  ai: AIProvider
  git: GitClient
  platform: GitPlatform
  confirmation: Confirmation
  mode: ConfirmMode
  prId: string
  commentId?: string    // if not provided, fix all unresolved blockers
}

export interface CommentFixerResult {
  status: 'fixed' | 'skipped' | 'cancelled' | 'dryrun'
  fixedComments: string[]    // comment ids that were fixed
  skippedComments: string[]  // comment ids that were skipped
}

export function createCommentFixer(
  input: CommentFixerInput
): {
  run(): Promise<CommentFixerResult>
}
```

## Flow

### Single comment fix (commentId provided)
1. Call platform.getPRComments(prId) and find matching commentId
2. If not found throw CommentFixerError "Comment {id} not found in PR {prId}"
3. Read current content of comment.file from disk
4. Build prompt for AI with file content and comment body
5. Get the fixed file content from AI as a complete file replacement
6. Show preview via confirmation (show a diff of old vs new)
7. Handle confirmation:
   - yes  → write fixed content to file, stage, commit, push, 
             resolve comment on platform, return fixed
   - no   → return skipped
   - edit → open editor with fixed content, apply edited version
   - dryrun → print diff, return dryrun

### All blockers fix (no commentId provided)
1. Get all PR comments from platform
2. Filter to unresolved comments with severity blocker
3. If none found, return fixed with empty fixedComments
4. For each blocker, run single comment fix flow
5. Batch commit all fixes in one commit (not one commit per fix)
6. Return fixed with all fixed comment ids

## Prompt for AI