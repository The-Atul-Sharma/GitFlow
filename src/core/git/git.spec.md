# Module: git

## Purpose

Wrap git operations needed across gpilot modules so we have one
tested place that talks to git, not scattered shell calls everywhere.

## Public API

```ts
export interface GitClient {
  // Diffs
  getStagedDiff(): Promise<string>;
  getDiffAgainst(baseBranch: string): Promise<string>;

  // Commits
  getRecentCommits(count: number): Promise<CommitInfo[]>;
  setCommitMessage(message: string): Promise<void>;
  commit(message: string): Promise<void>;

  // Branches
  getCurrentBranch(): Promise<string>;
  getDefaultBranch(): Promise<string>; // main or master

  // Files
  getStagedFiles(): Promise<string[]>;
  getChangedFiles(baseBranch: string): Promise<string[]>;

  // Repo info
  getRemoteUrl(): Promise<string>;
  isInsideRepo(): Promise<boolean>;
}

export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: Date;
}

export function createGitClient(cwd?: string): GitClient;
```

## Implementation

- Use child_process.execFile (not exec) to avoid shell injection
- All commands run with cwd from the constructor (default: process.cwd())
- All output trimmed of trailing whitespace before returning
- Diff output returned as raw text, not parsed

## Rules

- Throw GitError when git command fails, including stderr in message
- Throw NotInRepoError when called outside a git repository
- getDefaultBranch checks for "main" first, falls back to "master"
- getRecentCommits returns newest first, limit to count parameter
- getStagedFiles returns paths relative to repo root
- setCommitMessage writes to .git/COMMIT_EDITMSG (used by prepare-commit-msg hook)

## Error cases

- Not inside a git repo → NotInRepoError "Not inside a git repository.
  Run git init first."
- Git command fails → GitError "<command> failed: <stderr>"
- Empty staged diff requested but nothing staged → return empty string,
  do not throw (caller decides what to do)

## Tests required

- getStagedDiff returns content when files are staged
- getStagedDiff returns empty string when nothing staged
- getRecentCommits returns parsed array with correct count
- getRecentCommits returns newest first
- getCurrentBranch returns current branch name
- getDefaultBranch returns 'main' when present
- getDefaultBranch falls back to 'master' when no main
- getStagedFiles returns array of relative paths
- isInsideRepo returns true inside repo, false outside
- Throws NotInRepoError outside a repo
- Throws GitError with stderr on failed git command
- Mock execFile in all tests, never run real git
