# Module: platforms/azureDevops

## Purpose

Implement the GitPlatform interface for Azure DevOps using the
Azure DevOps REST API. Identical contract to GitHubPlatform —
feature modules never know which platform they're talking to.

## Dependencies

- core/secrets — AZURE_DEVOPS_PAT retrieval

## Public API

```ts
export interface AzureDevOpsConfig {
  org: string; // Azure DevOps organisation name
  project: string; // project name
  repositoryId: string; // repository name or GUID
  pat: string; // AZURE_DEVOPS_PAT from secrets
}

export class AzureDevOpsPlatform implements GitPlatform {
  constructor(config: AzureDevOpsConfig);

  // From prCreator
  createPR(input: CreatePRInput): Promise<CreatedPR>;

  // From prReviewer
  getPRDiff(prId: string): Promise<string>;
  postInlineComment(prId: string, issue: InlineIssue): Promise<void>;

  // From commentFixer
  getPRComments(prId: string): Promise<PRComment[]>;
  resolveComment(prId: string, commentId: string): Promise<void>;
}

export function createAzureDevOpsPlatform(
  config: AzureDevOpsConfig,
): GitPlatform;
```

## Base URL

https://dev.azure.com/{org}/{project}/_apis

## Authentication

Azure DevOps uses HTTP Basic auth with PAT:

```ts
const encoded = Buffer.from(`:${pat}`).toString("base64");
headers["Authorization"] = `Basic ${encoded}`;
headers["Content-Type"] = "application/json";
```

## API version

All requests must include: `?api-version=7.0`

## Implementation details

### createPR

- POST /git/repositories/{repositoryId}/pullrequests
- Request body:

```json
{
  "title": "{title}",
  "description": "{body}",
  "sourceRefName": "refs/heads/{sourceBranch}",
  "targetRefName": "refs/heads/{targetBranch}"
}
```

- Return:
  - id: string(pullRequestId)
  - url: \_links.web.href
  - number: pullRequestId

### getPRDiff

- GET /git/repositories/{repositoryId}/pullrequests/{prId}/iterations
  to get latest iteration id
- GET /git/repositories/{repositoryId}/pullrequests/{prId}/iterations/{iterationId}/changes
  to get file changes
- For each changed file, build unified diff format string manually
- Return concatenated unified diff for all changed files

### postInlineComment

- POST /git/repositories/{repositoryId}/pullrequests/{prId}/threads
- Request body:

```json
  {
    "comments": [{
      "content": "[{SEVERITY}] {comment}\n\n{suggestedFix}",
      "commentType": 1
    }],
    "threadContext": {
      "filePath": "{file}",
      "rightFileStart": { "line": {line}, "offset": 1 },
      "rightFileEnd": { "line": {line}, "offset": 1 }
    },
    "status": 1
  }
```

- Thread status: 1 = Active (blocker), 4 = Closed (info)
- Use status 1 for blocker and warning, 4 for info

### getPRComments

- GET /git/repositories/{repositoryId}/pullrequests/{prId}/threads
- Filter to threads where isDeleted is false
- For each thread, take the first comment in comments array
- Map to PRComment:
  - id: string(thread.id)
  - file: threadContext.filePath (null if no threadContext — skip these)
  - line: threadContext.rightFileStart.line
  - body: comments[0].content
  - severity: parse from body prefix [BLOCKER]/[WARNING]/[INFO]

### resolveComment

- PATCH /git/repositories/{repositoryId}/pullrequests/{prId}/threads/{threadId}

```json
{ "status": 2 }
```

- Status 2 = Fixed in Azure DevOps thread status enum

## Rules

- Branch refs must use full format: "refs/heads/{branchName}"
- Never log the PAT value
- All requests use fetch (no third party HTTP library needed)
- Retry once on 429 rate limit with 60 second delay
- Throw AzureDevOpsError on non-2xx responses with status and message
- prId is always a string — convert to number where API requires integer
- Skip threads with no threadContext in getPRComments (general comments)
- repositoryId can be the repo name string or a GUID — pass through as-is

## Error cases

- 401 → AzureDevOpsError "Azure DevOps PAT invalid or expired.
  Run: npx gpilot auth"
- 403 → AzureDevOpsError "PAT lacks required permissions.
  Needs: Code (Read & Write), Pull Request Threads (Read & Write)"
- 404 PR → AzureDevOpsError "PR #{prId} not found in {org}/{project}"
- 404 repo → AzureDevOpsError "Repository {repositoryId} not found.
  Check org, project, and repository name in gpilot.config.yml"
- 409 Conflict → AzureDevOpsError "PR already exists for this branch"
- 429 rate limit → retry once after 60s, throw if still fails
- Network failure → wrap in AzureDevOpsError with original message

## Tests required

- createPR sends correct body with refs/heads/ prefixed branch names
- createPR returns mapped CreatedPR with id, url, number
- getPRDiff fetches iterations then changes, returns unified diff string
- postInlineComment sends thread with correct threadContext
- postInlineComment sets status 1 for blocker, 4 for info
- getPRComments maps threads to PRComment array
- getPRComments skips threads with no threadContext
- getPRComments parses severity from body prefix
- resolveComment patches thread with status 2
- 401 throws with helpful auth message
- 403 throws with permissions detail
- 404 PR throws with PR not found message
- 404 repo throws with repo config hint
- 429 retries once then throws
- PAT never appears in logs
- Mock fetch in all tests, never call real Azure DevOps API
