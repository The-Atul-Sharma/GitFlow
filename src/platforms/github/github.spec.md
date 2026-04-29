# Module: platforms/github

## Purpose

Implement the GitPlatform interface for GitHub using the GitHub REST API.
All feature modules talk to this via the interface — no module imports
GitHub-specific code directly.

## Dependencies

- core/secrets — GITHUB_TOKEN retrieval
- @octokit/rest — GitHub REST API client

## Public API

```ts
export interface GitHubConfig {
  owner: string; // GitHub org or username
  repo: string; // repository name
  token: string; // GITHUB_TOKEN from secrets
}

export class GitHubPlatform implements GitPlatform {
  constructor(config: GitHubConfig);

  // From prCreator
  createPR(input: CreatePRInput): Promise<CreatedPR>;

  // From prReviewer
  getPRDiff(prId: string): Promise<string>;
  postInlineComment(prId: string, issue: InlineIssue): Promise<void>;

  // From commentFixer
  getPRComments(prId: string): Promise<PRComment[]>;
  resolveComment(prId: string, commentId: string): Promise<void>;
}

export function createGitHubPlatform(config: GitHubConfig): GitPlatform;
```

## Implementation details

### createPR

- POST /repos/{owner}/{repo}/pulls
- Map CreatePRInput.sourceBranch → head
- Map CreatePRInput.targetBranch → base
- Return id as string(pull_number), url, number

### getPRDiff

- GET /repos/{owner}/{repo}/pulls/{pull_number}
- Set Accept: application/vnd.github.v3.diff header
- Returns raw unified diff as string

### postInlineComment

- POST /repos/{owner}/{repo}/pulls/{pull_number}/comments
- Map InlineIssue.file → path
- Map InlineIssue.line → line
- Map InlineIssue.comment + severity tag → body
  Format body as: "[{SEVERITY}] {comment}\n\n{suggestedFix if present}"
- Use side: "RIGHT" for all comments (new version of file)
- commit_id: get from latest commit on PR head

### getPRComments

- GET /repos/{owner}/{repo}/pulls/{pull_number}/comments
- Map GitHub response to PRComment interface:
  - id: string(comment.id)
  - file: comment.path
  - line: comment.line
  - body: comment.body
  - severity: parse from body prefix [BLOCKER]/[WARNING]/[INFO] if present

### resolveComment

- GitHub has no native "resolve" for review comments
- Instead mark as outdated by replying with a fixed marker
- POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies
  body: "✓ Fixed"

## Rules

- All API calls must include Authorization: Bearer {token} header
- Retry once on 429 (rate limit) with 60 second delay
- Throw GitHubError on 4xx/5xx responses including the status and message
- prId is always a string — convert to number before passing to Octokit
- Never log the token value, only mask last 4 chars for debug: "\*\*\*\*abcd"
- owner and repo parsed from git remote URL if not explicitly provided
- Use @octokit/rest not raw fetch for all API calls

## Error cases

- 401 Unauthorized → GitHubError "GitHub token invalid or expired.
  Run: npx gpilot auth"
- 403 Forbidden → GitHubError "GitHub token lacks required permissions.
  Needs: repo, pull_requests"
- 404 Not Found → GitHubError "PR #{prId} not found in {owner}/{repo}"
- 422 Unprocessable → GitHubError "PR already exists for this branch"
- 429 Rate Limited → retry after 60s, throw if still fails
- Network failure → wrap in GitHubError with original message

## Tests required

- createPR calls correct endpoint with mapped fields
- createPR returns CreatedPR with id, url, number
- getPRDiff calls diff endpoint with correct Accept header
- postInlineComment formats body with severity tag
- postInlineComment uses side: RIGHT
- getPRComments maps GitHub response to PRComment array
- getPRComments parses severity from body prefix
- resolveComment posts reply with fixed marker
- 401 throws with helpful auth message
- 403 throws with permissions message
- 404 throws with PR not found message
- 429 retries once then throws
- Token never appears in logs
- prId string converted to number for Octokit calls
- Mock @octokit/rest in all tests, never call real GitHub API
