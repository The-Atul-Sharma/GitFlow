import { z } from "zod";
import { Octokit } from "@octokit/rest";
import type {
  CreatePRInput,
  CreatedPR,
} from "../../modules/prCreator/index.ts";
import type { InlineIssue } from "../../modules/prReviewer/index.ts";
import type {
  PRComment,
  CommentSeverity,
} from "../../modules/commentFixer/index.ts";

export interface GitHubConfig {
  owner: string;
  repo: string;
  token: string;
}

export interface GitPlatform {
  readonly name?: string;
  createPR(input: CreatePRInput): Promise<CreatedPR>;
  getPRDiff(prId: string): Promise<string>;
  postInlineComment(prId: string, issue: InlineIssue): Promise<void>;
  getPRComments(prId: string): Promise<PRComment[]>;
  resolveComment(prId: string, commentId: string): Promise<void>;
}

export class GitHubError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "GitHubError";
    if (status !== undefined) this.status = status;
  }
}

const RATE_LIMIT_RETRY_DELAY_MS = 60_000;

const configSchema = z.object({
  owner: z
    .string()
    .min(
      1,
      'GitHub owner is empty. Pass the org or username (e.g. "octocat").',
    ),
  repo: z
    .string()
    .min(
      1,
      'GitHub repo is empty. Pass the repository name (e.g. "hello-world").',
    ),
  token: z
    .string()
    .min(
      1,
      "GitHub token is empty. Run: npx gpilot auth and store GITHUB_TOKEN.",
    ),
});

const prIdSchema = z
  .string()
  .min(
    1,
    'prId is empty. Pass the numeric GitHub pull_number as a string (e.g. "42").',
  );

const commentIdSchema = z
  .string()
  .min(
    1,
    "commentId is empty. Pass the numeric GitHub review comment id as a string.",
  );

const createPRInputSchema = z.object({
  title: z
    .string()
    .min(1, "createPR title is empty. Pass a non-empty PR title."),
  body: z.string(),
  sourceBranch: z
    .string()
    .min(
      1,
      'createPR sourceBranch is empty. Pass the head branch name (e.g. "feature/x").',
    ),
  targetBranch: z
    .string()
    .min(
      1,
      'createPR targetBranch is empty. Pass the base branch name (e.g. "main").',
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

interface OctokitErrorLike {
  status?: number;
  message?: string;
  response?: { data?: { message?: string } };
}

function isOctokitError(err: unknown): err is OctokitErrorLike {
  return typeof err === "object" && err !== null && "status" in err;
}

function errorDetail(err: unknown): string {
  if (isOctokitError(err)) {
    const fromBody = err.response?.data?.message;
    if (fromBody) return fromBody;
    if (err.message) return err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

function toPullNumber(prId: string): number {
  const n = Number(prId);
  if (!Number.isInteger(n) || n <= 0) {
    throw new GitHubError(
      `prId "${prId}" is not a valid GitHub pull_number. Pass the numeric id as a string (e.g. "42").`,
    );
  }
  return n;
}

function toCommentNumber(commentId: string): number {
  const n = Number(commentId);
  if (!Number.isInteger(n) || n <= 0) {
    throw new GitHubError(
      `commentId "${commentId}" is not a valid GitHub review comment id. Pass the numeric id as a string.`,
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

function mapGitHubError(
  err: unknown,
  context: { owner: string; repo: string; prId?: string },
): GitHubError {
  if (err instanceof GitHubError) return err;
  const status = isOctokitError(err) ? err.status : undefined;
  const detail = errorDetail(err);

  if (status === 401) {
    return new GitHubError(
      "GitHub token invalid or expired. Run: npx gpilot auth",
      401,
    );
  }
  if (status === 403) {
    return new GitHubError(
      "GitHub token lacks required permissions. Needs: repo, pull_requests",
      403,
    );
  }
  if (status === 404) {
    const where = `${context.owner}/${context.repo}`;
    const target = context.prId ? `PR #${context.prId}` : "resource";
    return new GitHubError(`${target} not found in ${where}`, 404);
  }
  if (status === 422) {
    if (context.prId) {
      return new GitHubError(
        `GitHub rejected the inline review comment: ${detail}. This usually means the file/line is outdated for the current PR diff. Refresh review results and retry.`,
        422,
      );
    }
    return new GitHubError(
      "PR already exists for this branch. Push a new commit and re-run, or close the existing PR before retrying.",
      422,
    );
  }
  if (status === 429) {
    return new GitHubError(
      `GitHub rate limit exceeded after retry: ${detail}. Wait for the limit to reset, then re-run.`,
      429,
    );
  }
  if (status !== undefined) {
    return new GitHubError(
      `GitHub API error (${status}): ${detail}. Address the cause above and re-run.`,
      status,
    );
  }
  return new GitHubError(
    `GitHub request failed: ${detail}. Check your network connection and re-run.`,
  );
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withRetry<T>(
  context: { owner: string; repo: string; prId?: string },
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const status = isOctokitError(err) ? err.status : undefined;
    if (status === 429) {
      await delay(RATE_LIMIT_RETRY_DELAY_MS);
      try {
        return await fn();
      } catch (retryErr) {
        throw mapGitHubError(retryErr, context);
      }
    }
    throw mapGitHubError(err, context);
  }
}

/**
 * Parse `owner` and `repo` from a GitHub remote URL.
 *
 * Supports both HTTPS (`https://github.com/owner/repo.git`) and SSH
 * (`git@github.com:owner/repo.git`) formats. The trailing `.git` is stripped.
 *
 * @param remoteUrl - the value of `git remote get-url origin`
 * @returns `{ owner, repo }`
 * @throws GitHubError when the URL does not look like a GitHub remote
 */
export function parseGitHubRemote(remoteUrl: string): {
  owner: string;
  repo: string;
} {
  const trimmed = remoteUrl.trim();
  const match =
    trimmed.match(/^https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/) ??
    trimmed.match(/^git@[^:]+:([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!match || !match[1] || !match[2]) {
    throw new GitHubError(
      `Could not parse GitHub owner/repo from remote URL "${remoteUrl}". Set the remote with: git remote set-url origin git@github.com:OWNER/REPO.git`,
    );
  }
  return { owner: match[1], repo: match[2] };
}

/**
 * GitHub implementation of the GitPlatform interface.
 *
 * All API calls go through `@octokit/rest` with Bearer token auth. On HTTP 429
 * the call is retried once after a 60-second delay. All other 4xx/5xx
 * responses are wrapped in `GitHubError` with a remediation hint. The token
 * is never logged.
 */
export class GitHubPlatform implements GitPlatform {
  readonly name = "GitHub";
  readonly #owner: string;
  readonly #repo: string;
  readonly #octokit: Octokit;

  constructor(config: GitHubConfig) {
    const validated = configSchema.parse(config);
    this.#owner = validated.owner;
    this.#repo = validated.repo;
    this.#octokit = new Octokit({ auth: validated.token });
  }

  /**
   * Open a pull request on GitHub.
   *
   * Maps `sourceBranch` → `head` and `targetBranch` → `base`. Returns the
   * created PR's number (as both string `id` and numeric `number`) and the
   * web URL for the PR page.
   *
   * @param input - title, body, source branch, and target branch
   * @returns the created PR's id, url, and number
   * @throws GitHubError on auth, permission, not-found, conflict, or network errors
   */
  async createPR(input: CreatePRInput): Promise<CreatedPR> {
    const validated = createPRInputSchema.parse(input);
    return withRetry({ owner: this.#owner, repo: this.#repo }, async () => {
      const response = await this.#octokit.pulls.create({
        owner: this.#owner,
        repo: this.#repo,
        title: validated.title,
        body: validated.body,
        head: validated.sourceBranch,
        base: validated.targetBranch,
      });
      return {
        id: String(response.data.number),
        url: response.data.html_url,
        number: response.data.number,
      };
    });
  }

  /**
   * Fetch the unified diff for a pull request.
   *
   * Sends `Accept: application/vnd.github.v3.diff` so GitHub returns the raw
   * diff body rather than the JSON PR object.
   *
   * @param prId - the GitHub pull_number as a string
   * @returns the raw unified diff
   * @throws GitHubError on auth, permission, not-found, or network errors
   */
  async getPRDiff(prId: string): Promise<string> {
    const validated = prIdSchema.parse(prId);
    const pull_number = toPullNumber(validated);
    return withRetry(
      { owner: this.#owner, repo: this.#repo, prId: validated },
      async () => {
        const response = await this.#octokit.pulls.get({
          owner: this.#owner,
          repo: this.#repo,
          pull_number,
          mediaType: { format: "diff" },
        });
        return response.data as unknown as string;
      },
    );
  }

  /**
   * Post an inline review comment on a pull request.
   *
   * The body is prefixed with the issue's severity tag (`[BLOCKER]`,
   * `[WARNING]`, `[INFO]`); the suggested fix, if present, is appended after
   * a blank line. Comments are anchored to the new (RIGHT) version of the
   * file using the latest commit on the PR head.
   *
   * @param prId - the GitHub pull_number as a string
   * @param issue - file, line, severity, comment, and optional suggested fix
   * @throws GitHubError on auth, permission, not-found, or network errors
   */
  async postInlineComment(prId: string, issue: InlineIssue): Promise<void> {
    const validatedPr = prIdSchema.parse(prId);
    const validatedIssue = inlineIssueSchema.parse(issue);
    const pull_number = toPullNumber(validatedPr);
    await withRetry(
      { owner: this.#owner, repo: this.#repo, prId: validatedPr },
      async () => {
        const pr = await this.#octokit.pulls.get({
          owner: this.#owner,
          repo: this.#repo,
          pull_number,
        });
        const commit_id = pr.data.head.sha;
        const tag = `[${validatedIssue.severity.toUpperCase()}]`;
        const body = validatedIssue.suggestedFix
          ? `${tag} ${validatedIssue.comment}\n\n${validatedIssue.suggestedFix}`
          : `${tag} ${validatedIssue.comment}`;
        await this.#octokit.pulls.createReviewComment({
          owner: this.#owner,
          repo: this.#repo,
          pull_number,
          commit_id,
          path: validatedIssue.file,
          line: validatedIssue.line,
          side: "RIGHT",
          body,
        });
      },
    );
  }

  /**
   * List all review comments on a pull request.
   *
   * Severity is parsed from the body prefix (`[BLOCKER]`, `[WARNING]`,
   * `[INFO]`) when present; comments without a recognised tag have no
   * `severity` field set.
   *
   * @param prId - the GitHub pull_number as a string
   * @returns the PR's review comments mapped to `PRComment`
   * @throws GitHubError on auth, permission, not-found, or network errors
   */
  async getPRComments(prId: string): Promise<PRComment[]> {
    const validated = prIdSchema.parse(prId);
    const pull_number = toPullNumber(validated);
    return withRetry(
      { owner: this.#owner, repo: this.#repo, prId: validated },
      async () => {
        const response = await this.#octokit.pulls.listReviewComments({
          owner: this.#owner,
          repo: this.#repo,
          pull_number,
        });
        return response.data.map((c) => {
          const comment: PRComment = {
            id: String(c.id),
            file: c.path,
            line: c.line ?? c.original_line ?? 0,
            body: c.body,
          };
          const severity = parseSeverity(c.body);
          if (severity) comment.severity = severity;
          return comment;
        });
      },
    );
  }

  /**
   * Mark a review comment as resolved by replying with a fixed marker.
   *
   * GitHub has no native "resolve" for review comments, so this posts a
   * `"✓ Fixed"` reply on the comment thread.
   *
   * @param prId - the GitHub pull_number as a string
   * @param commentId - the review comment id as a string
   * @throws GitHubError on auth, permission, not-found, or network errors
   */
  async resolveComment(prId: string, commentId: string): Promise<void> {
    const validatedPr = prIdSchema.parse(prId);
    const validatedComment = commentIdSchema.parse(commentId);
    const pull_number = toPullNumber(validatedPr);
    const comment_id = toCommentNumber(validatedComment);
    await withRetry(
      { owner: this.#owner, repo: this.#repo, prId: validatedPr },
      async () => {
        await this.#octokit.pulls.createReplyForReviewComment({
          owner: this.#owner,
          repo: this.#repo,
          pull_number,
          comment_id,
          body: "✓ Fixed",
        });
      },
    );
  }
}

/**
 * Build a GitHub `GitPlatform` from owner, repo, and token.
 *
 * Thin factory around `new GitHubPlatform(config)` returned as the
 * `GitPlatform` interface so call sites stay platform-agnostic.
 *
 * @param config - owner, repo, and GITHUB_TOKEN
 * @returns a GitPlatform implementation backed by GitHub
 */
export function createGitHubPlatform(config: GitHubConfig): GitPlatform {
  return new GitHubPlatform(config);
}
