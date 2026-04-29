import { Buffer } from "node:buffer";
import { z } from "zod";
import type {
  CreatePRInput,
  CreatedPR,
} from "../../modules/prCreator/index.ts";
import type { InlineIssue } from "../../modules/prReviewer/index.ts";
import type {
  PRComment,
  CommentSeverity,
} from "../../modules/commentFixer/index.ts";
import type { GitPlatform } from "../github/index.ts";

export type { GitPlatform } from "../github/index.ts";

export interface AzureDevOpsConfig {
  org: string;
  project: string;
  repositoryId: string;
  pat: string;
}

export class AzureDevOpsError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "AzureDevOpsError";
    if (status !== undefined) this.status = status;
  }
}

const RATE_LIMIT_RETRY_DELAY_MS = 60_000;
const API_VERSION = "7.0";

const configSchema = z.object({
  org: z
    .string()
    .min(
      1,
      'Azure DevOps org is empty. Pass the organisation slug from dev.azure.com/{org} (e.g. "contoso").',
    ),
  project: z
    .string()
    .min(
      1,
      "Azure DevOps project is empty. Pass the project name from dev.azure.com/{org}/{project}.",
    ),
  repositoryId: z
    .string()
    .min(
      1,
      "Azure DevOps repositoryId is empty. Pass the repository name or GUID.",
    ),
  pat: z
    .string()
    .min(
      1,
      "Azure DevOps PAT is empty. Run: npx gpilot auth and store AZURE_DEVOPS_PAT.",
    ),
});

const prIdSchema = z
  .string()
  .min(
    1,
    'prId is empty. Pass the Azure DevOps pullRequestId as a string (e.g. "42").',
  );

const commentIdSchema = z
  .string()
  .min(1, "commentId is empty. Pass the Azure DevOps thread id as a string.");

const createPRInputSchema = z.object({
  title: z
    .string()
    .min(1, "createPR title is empty. Pass a non-empty PR title."),
  body: z.string(),
  sourceBranch: z
    .string()
    .min(
      1,
      'createPR sourceBranch is empty. Pass the source branch name (e.g. "feature/x").',
    ),
  targetBranch: z
    .string()
    .min(
      1,
      'createPR targetBranch is empty. Pass the target branch name (e.g. "main").',
    ),
});

const inlineIssueSchema = z.object({
  file: z
    .string()
    .min(
      1,
      'issue.file is empty. Pass the file path from the diff (e.g. "src/foo.ts").',
    ),
  line: z
    .number()
    .int("issue.line must be an integer line number.")
    .positive("issue.line must be > 0. Pass a 1-based line number."),
  severity: z.enum(["blocker", "warning", "info"], {
    message: 'issue.severity must be one of "blocker", "warning", "info".',
  }),
  comment: z
    .string()
    .min(1, "issue.comment is empty. Pass a non-empty review comment body."),
  suggestedFix: z.string().optional(),
});

interface RequestContext {
  org: string;
  project: string;
  repositoryId: string;
  prId?: string;
}

function toIntegerId(value: string, label: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new AzureDevOpsError(
      `${label} "${value}" is not a valid Azure DevOps integer id. Pass the numeric id as a string.`,
    );
  }
  return n;
}

function parseSeverity(body: string): CommentSeverity | undefined {
  const match = body.match(/^\[(BLOCKER|WARNING|INFO)\]/);
  if (!match) return undefined;
  const tag = match[1];
  if (tag === "BLOCKER") return "blocker";
  if (tag === "WARNING") return "warning";
  return "info";
}

function severityToThreadStatus(
  severity: "blocker" | "warning" | "info",
): number {
  return severity === "info" ? 4 : 1;
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

async function throwForStatus(
  response: Response,
  context: RequestContext,
): Promise<never> {
  const detail = await readResponseText(response);

  if (response.status === 401) {
    throw new AzureDevOpsError(
      "Azure DevOps PAT invalid or expired. Run: npx gpilot auth",
      401,
    );
  }
  if (response.status === 403) {
    throw new AzureDevOpsError(
      "PAT lacks required permissions. Needs: Code (Read & Write), Pull Request Threads (Read & Write)",
      403,
    );
  }
  if (response.status === 404) {
    if (context.prId) {
      throw new AzureDevOpsError(
        `PR #${context.prId} not found in ${context.org}/${context.project}`,
        404,
      );
    }
    throw new AzureDevOpsError(
      `Repository ${context.repositoryId} not found. Check org, project, and repository name in gpilot.config.yml`,
      404,
    );
  }
  if (response.status === 409) {
    throw new AzureDevOpsError("PR already exists for this branch", 409);
  }
  if (response.status === 429) {
    throw new AzureDevOpsError(
      "Azure DevOps rate limit exceeded after retry. Wait for the limit to reset, then re-run.",
      429,
    );
  }

  const message = detail.trim().length > 0 ? detail : response.statusText;
  throw new AzureDevOpsError(
    `Azure DevOps API error (${response.status}): ${message}. Address the cause above and re-run.`,
    response.status,
  );
}

async function azureFetch(
  url: string,
  init: RequestInit,
  context: RequestContext,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new AzureDevOpsError(
      `Azure DevOps request failed: ${reason}. Check your network connection and re-run.`,
    );
  }

  if (response.status === 429) {
    await delay(RATE_LIMIT_RETRY_DELAY_MS);
    try {
      response = await fetch(url, init);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new AzureDevOpsError(
        `Azure DevOps request failed after retry: ${reason}. Check your network connection and re-run.`,
      );
    }
  }

  if (!response.ok) {
    await throwForStatus(response, context);
  }
  return response;
}

interface IterationsResponse {
  value?: Array<{ id: number }>;
}

interface ChangesResponse {
  changeEntries?: Array<{
    changeType?: string;
    item?: { path?: string };
  }>;
}

interface ThreadResponse {
  value?: Array<{
    id: number;
    isDeleted?: boolean;
    threadContext?: {
      filePath?: string;
      rightFileStart?: { line?: number };
    } | null;
    comments?: Array<{ content?: string }>;
  }>;
}

interface CreatePullRequestResponse {
  pullRequestId: number;
  _links?: { web?: { href?: string } };
}

function buildFileDiff(path: string, changeType: string): string {
  const cleanPath = path.replace(/^\//, "");
  return [
    `diff --git a/${cleanPath} b/${cleanPath}`,
    `--- a/${cleanPath}`,
    `+++ b/${cleanPath}`,
    `@@ change: ${changeType} @@`,
  ].join("\n");
}

/**
 * Azure DevOps implementation of the GitPlatform interface.
 *
 * All API calls go through the global `fetch` against
 * `https://dev.azure.com/{org}/{project}/_apis` with HTTP Basic auth derived
 * from the user's PAT (`Authorization: Basic base64(":${pat}")`). Each request
 * pins `?api-version=7.0`. On HTTP 429 the call is retried once after a
 * 60-second delay; all other 4xx/5xx responses are wrapped in
 * `AzureDevOpsError` with a remediation hint. The PAT is never logged.
 */
export class AzureDevOpsPlatform implements GitPlatform {
  readonly name = "Azure DevOps";
  readonly #org: string;
  readonly #project: string;
  readonly #repositoryId: string;
  readonly #authHeader: string;

  constructor(config: AzureDevOpsConfig) {
    const validated = configSchema.parse(config);
    this.#org = validated.org;
    this.#project = validated.project;
    this.#repositoryId = validated.repositoryId;
    const encoded = Buffer.from(`:${validated.pat}`).toString("base64");
    this.#authHeader = `Basic ${encoded}`;
  }

  #baseUrl(): string {
    return `https://dev.azure.com/${this.#org}/${this.#project}/_apis`;
  }

  #headers(): Record<string, string> {
    return {
      Authorization: this.#authHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  #context(prId?: string): RequestContext {
    const ctx: RequestContext = {
      org: this.#org,
      project: this.#project,
      repositoryId: this.#repositoryId,
    };
    if (prId !== undefined) ctx.prId = prId;
    return ctx;
  }

  /**
   * Open a pull request on Azure DevOps.
   *
   * Branch names are wrapped in the required `refs/heads/{branch}` format and
   * the PR body is sent as `description`. Returns the new pullRequestId (as
   * both string `id` and numeric `number`) and the web URL from `_links.web`.
   *
   * @param input - title, body, source branch, and target branch
   * @returns the created PR's id, url, and number
   * @throws AzureDevOpsError on auth, permission, repo-not-found, conflict, or network errors
   */
  async createPR(input: CreatePRInput): Promise<CreatedPR> {
    const validated = createPRInputSchema.parse(input);
    const url = `${this.#baseUrl()}/git/repositories/${this.#repositoryId}/pullrequests?api-version=${API_VERSION}`;
    const body = {
      title: validated.title,
      description: validated.body,
      sourceRefName: `refs/heads/${validated.sourceBranch}`,
      targetRefName: `refs/heads/${validated.targetBranch}`,
    };
    const response = await azureFetch(
      url,
      {
        method: "POST",
        headers: this.#headers(),
        body: JSON.stringify(body),
      },
      this.#context(),
    );
    const data = (await response.json()) as CreatePullRequestResponse;
    return {
      id: String(data.pullRequestId),
      url: data._links?.web?.href ?? "",
      number: data.pullRequestId,
    };
  }

  /**
   * Fetch a unified-diff representation of a pull request.
   *
   * First retrieves the PR's iterations and uses the latest iteration id to
   * fetch the change set, then composes a unified-diff string with one
   * file-header block per changed file (the change type is preserved in a
   * hunk header).
   *
   * @param prId - the Azure DevOps pullRequestId as a string
   * @returns a unified-diff string covering every changed file in the latest iteration
   * @throws AzureDevOpsError on auth, permission, PR-not-found, or network errors
   */
  async getPRDiff(prId: string): Promise<string> {
    const validated = prIdSchema.parse(prId);
    const prNumber = toIntegerId(validated, "prId");
    const ctx = this.#context(validated);

    const iterationsUrl = `${this.#baseUrl()}/git/repositories/${this.#repositoryId}/pullrequests/${prNumber}/iterations?api-version=${API_VERSION}`;
    const iterationsResponse = await azureFetch(
      iterationsUrl,
      { method: "GET", headers: this.#headers() },
      ctx,
    );
    const iterationsData =
      (await iterationsResponse.json()) as IterationsResponse;
    const iterations = iterationsData.value ?? [];
    if (iterations.length === 0) return "";
    const latest = iterations[iterations.length - 1];
    if (!latest) return "";
    const latestIterationId = latest.id;

    const changesUrl = `${this.#baseUrl()}/git/repositories/${this.#repositoryId}/pullrequests/${prNumber}/iterations/${latestIterationId}/changes?api-version=${API_VERSION}`;
    const changesResponse = await azureFetch(
      changesUrl,
      { method: "GET", headers: this.#headers() },
      ctx,
    );
    const changesData = (await changesResponse.json()) as ChangesResponse;
    const entries = changesData.changeEntries ?? [];

    const blocks: string[] = [];
    for (const entry of entries) {
      const path = entry.item?.path;
      if (!path) continue;
      const changeType = entry.changeType ?? "edit";
      blocks.push(buildFileDiff(path, changeType));
    }
    return blocks.join("\n");
  }

  /**
   * Post an inline review comment on a pull request as a new thread.
   *
   * The thread anchors to the right (new) side of the file at the issue's
   * line. The body is prefixed with the severity tag (`[BLOCKER]`,
   * `[WARNING]`, `[INFO]`) and an optional suggested fix is appended after a
   * blank line. Thread status is `1` (Active) for blocker and warning, `4`
   * (Closed) for info.
   *
   * @param prId - the Azure DevOps pullRequestId as a string
   * @param issue - file, line, severity, comment, and optional suggested fix
   * @throws AzureDevOpsError on auth, permission, PR-not-found, or network errors
   */
  async postInlineComment(prId: string, issue: InlineIssue): Promise<void> {
    const validatedPr = prIdSchema.parse(prId);
    const validatedIssue = inlineIssueSchema.parse(issue);
    const prNumber = toIntegerId(validatedPr, "prId");
    const ctx = this.#context(validatedPr);

    const tag = `[${validatedIssue.severity.toUpperCase()}]`;
    const content = validatedIssue.suggestedFix
      ? `${tag} ${validatedIssue.comment}\n\n${validatedIssue.suggestedFix}`
      : `${tag} ${validatedIssue.comment}`;

    const url = `${this.#baseUrl()}/git/repositories/${this.#repositoryId}/pullrequests/${prNumber}/threads?api-version=${API_VERSION}`;
    const body = {
      comments: [{ content, commentType: 1 }],
      threadContext: {
        filePath: validatedIssue.file,
        rightFileStart: { line: validatedIssue.line, offset: 1 },
        rightFileEnd: { line: validatedIssue.line, offset: 1 },
      },
      status: severityToThreadStatus(validatedIssue.severity),
    };

    await azureFetch(
      url,
      {
        method: "POST",
        headers: this.#headers(),
        body: JSON.stringify(body),
      },
      ctx,
    );
  }

  /**
   * List all non-deleted threads on a pull request as `PRComment`s.
   *
   * Threads without a `threadContext` (general discussion threads) are
   * skipped. For each remaining thread the first comment becomes the
   * `PRComment` body, the thread id becomes its string id, and the right-side
   * line number is used. Severity is parsed from the body prefix
   * (`[BLOCKER]` / `[WARNING]` / `[INFO]`) when present.
   *
   * @param prId - the Azure DevOps pullRequestId as a string
   * @returns the PR's file-anchored threads mapped to `PRComment`
   * @throws AzureDevOpsError on auth, permission, PR-not-found, or network errors
   */
  async getPRComments(prId: string): Promise<PRComment[]> {
    const validated = prIdSchema.parse(prId);
    const prNumber = toIntegerId(validated, "prId");
    const ctx = this.#context(validated);

    const url = `${this.#baseUrl()}/git/repositories/${this.#repositoryId}/pullrequests/${prNumber}/threads?api-version=${API_VERSION}`;
    const response = await azureFetch(
      url,
      { method: "GET", headers: this.#headers() },
      ctx,
    );
    const data = (await response.json()) as ThreadResponse;
    const threads = data.value ?? [];

    const result: PRComment[] = [];
    for (const thread of threads) {
      if (thread.isDeleted) continue;
      const tc = thread.threadContext;
      if (!tc || !tc.filePath) continue;
      const firstComment = thread.comments?.[0];
      if (!firstComment) continue;
      const body = firstComment.content ?? "";
      const comment: PRComment = {
        id: String(thread.id),
        file: tc.filePath,
        line: tc.rightFileStart?.line ?? 0,
        body,
      };
      const severity = parseSeverity(body);
      if (severity) comment.severity = severity;
      result.push(comment);
    }
    return result;
  }

  /**
   * Mark a pull request thread as resolved.
   *
   * Patches the thread with `status: 2` (Fixed) in the Azure DevOps thread
   * status enum.
   *
   * @param prId - the Azure DevOps pullRequestId as a string
   * @param commentId - the Azure DevOps thread id as a string
   * @throws AzureDevOpsError on auth, permission, PR-not-found, or network errors
   */
  async resolveComment(prId: string, commentId: string): Promise<void> {
    const validatedPr = prIdSchema.parse(prId);
    const validatedComment = commentIdSchema.parse(commentId);
    const prNumber = toIntegerId(validatedPr, "prId");
    const threadId = toIntegerId(validatedComment, "commentId");
    const ctx = this.#context(validatedPr);

    const url = `${this.#baseUrl()}/git/repositories/${this.#repositoryId}/pullrequests/${prNumber}/threads/${threadId}?api-version=${API_VERSION}`;
    await azureFetch(
      url,
      {
        method: "PATCH",
        headers: this.#headers(),
        body: JSON.stringify({ status: 2 }),
      },
      ctx,
    );
  }
}

/**
 * Build an Azure DevOps `GitPlatform` from org, project, repositoryId, and PAT.
 *
 * Thin factory around `new AzureDevOpsPlatform(config)` returned as the
 * `GitPlatform` interface so call sites stay platform-agnostic.
 *
 * @param config - org, project, repositoryId, and AZURE_DEVOPS_PAT
 * @returns a GitPlatform implementation backed by Azure DevOps
 */
export function createAzureDevOpsPlatform(
  config: AzureDevOpsConfig,
): GitPlatform {
  return new AzureDevOpsPlatform(config);
}
