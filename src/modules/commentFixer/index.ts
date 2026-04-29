import { z } from "zod";
import chalk from "chalk";
import { readFile, writeFile } from "node:fs/promises";
import type { AIProvider } from "../../core/ai/index.ts";
import type { GitClient } from "../../core/git/index.ts";
import type {
  Confirmation,
  ConfirmMode,
  ConfirmResult,
} from "../../core/confirmation/index.ts";
import type { GitPlatform as PrReviewerGitPlatform } from "../prReviewer/index.ts";

export type CommentSeverity = "blocker" | "warning" | "info";

export interface PRComment {
  id: string;
  file: string;
  line: number;
  body: string;
  severity?: CommentSeverity;
  suggestedFix?: string;
}

export interface GitPlatform extends PrReviewerGitPlatform {
  getPRComments(prId: string): Promise<PRComment[]>;
  resolveComment(prId: string, commentId: string): Promise<void>;
}

export type CommentFixerGitClient = GitClient & {
  stage(files: string[]): Promise<void>;
  push(branch: string): Promise<void>;
};

export interface CommentFixerInput {
  ai: AIProvider;
  git: CommentFixerGitClient;
  platform: GitPlatform;
  confirmation: Confirmation;
  mode: ConfirmMode;
  prId: string;
  commentId?: string;
}

export interface CommentFixerResult {
  status: "fixed" | "skipped" | "cancelled" | "dryrun";
  fixedComments: string[];
  skippedComments: string[];
}

export class CommentFixerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommentFixerError";
  }
}

const MAX_FILE_CHARS = 60_000;

const inputSchema = z.object({
  ai: z.custom<AIProvider>(
    (v) =>
      v !== null &&
      typeof v === "object" &&
      typeof (v as AIProvider).complete === "function",
    "ai must be an AIProvider. Build one with createAIProvider() from core/ai.",
  ),
  git: z.custom<CommentFixerGitClient>(
    (v) =>
      v !== null &&
      typeof v === "object" &&
      typeof (v as CommentFixerGitClient).getCurrentBranch === "function" &&
      typeof (v as CommentFixerGitClient).commit === "function" &&
      typeof (v as CommentFixerGitClient).stage === "function" &&
      typeof (v as CommentFixerGitClient).push === "function",
    "git must be a GitClient that supports stage(files) and push(branch). Build one with createGitClient() from core/git and extend it with stage/push.",
  ),
  platform: z.custom<GitPlatform>(
    (v) =>
      v !== null &&
      typeof v === "object" &&
      typeof (v as GitPlatform).getPRComments === "function" &&
      typeof (v as GitPlatform).resolveComment === "function",
    "platform must be a GitPlatform with getPRComments() and resolveComment(). Build one with createGithubPlatform() or createAzureDevopsPlatform().",
  ),
  confirmation: z.custom<Confirmation>(
    (v) =>
      v !== null &&
      typeof v === "object" &&
      typeof (v as Confirmation).ask === "function",
    "confirmation must be a Confirmation. Build one with createConfirmation() from core/confirmation.",
  ),
  mode: z.enum(["interactive", "auto", "dryrun"], {
    message:
      'mode must be one of "interactive", "auto", or "dryrun". Pass mode from the CLI flag (--auto / --dry-run).',
  }),
  prId: z
    .string()
    .min(
      1,
      "prId is empty. Pass a non-empty PR id matching the pull request you want to fix.",
    ),
  commentId: z
    .string()
    .min(
      1,
      "commentId is empty. Omit to fix all unresolved blockers, or pass a non-empty comment id.",
    )
    .optional(),
});

function truncateFile(content: string): string {
  if (content.length <= MAX_FILE_CHARS) return content;
  return `${content.slice(0, MAX_FILE_CHARS)}\n\n// [file truncated at ${MAX_FILE_CHARS} chars]`;
}

function buildPrompt(
  filePath: string,
  fileContent: string,
  comment: PRComment,
): string {
  const severity = comment.severity ?? "info";
  const fixHint = comment.suggestedFix
    ? `\nSuggested fix from reviewer:\n${comment.suggestedFix}\n`
    : "";
  return (
    `You are a senior engineer fixing a pull request review comment.\n\n` +
    `Apply the requested change to the file below and output the COMPLETE updated file content.\n` +
    `Output ONLY the file contents — no code fences, no preface, no explanation.\n` +
    `Preserve existing formatting, indentation, imports, and unrelated code exactly as-is.\n` +
    `Do not add comments describing the fix.\n\n` +
    `File: ${filePath}\n` +
    `Comment is on line ${comment.line} (${severity}):\n${comment.body}\n` +
    `${fixHint}\n` +
    `Current file contents:\n${truncateFile(fileContent)}\n\n` +
    `Return ONLY the updated file contents.`
  );
}

function stripCodeFence(raw: string): string {
  let text = raw.replace(/^﻿/, "");
  const fenceMatch = text.match(
    /^\s*```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n```\s*$/,
  );
  if (fenceMatch && fenceMatch[1] !== undefined) {
    return fenceMatch[1];
  }
  return text;
}

function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const ai = a[i - 1];
      const bj = b[j - 1];
      const prevRow = dp[i - 1];
      const currRow = dp[i];
      if (!prevRow || !currRow) continue;
      if (ai === bj) {
        currRow[j] = (prevRow[j - 1] ?? 0) + 1;
      } else {
        currRow[j] = Math.max(prevRow[j] ?? 0, currRow[j - 1] ?? 0);
      }
    }
  }
  return dp;
}

function unifiedDiff(oldContent: string, newContent: string): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const dp = lcsTable(oldLines, newLines);
  const ops: string[] = [];
  let i = oldLines.length;
  let j = newLines.length;
  while (i > 0 && j > 0) {
    if (oldLines[i - 1] === newLines[j - 1]) {
      ops.push(`  ${oldLines[i - 1]}`);
      i--;
      j--;
    } else {
      const up = dp[i - 1]?.[j] ?? 0;
      const left = dp[i]?.[j - 1] ?? 0;
      if (up >= left) {
        ops.push(chalk.red(`- ${oldLines[i - 1]}`));
        i--;
      } else {
        ops.push(chalk.green(`+ ${newLines[j - 1]}`));
        j--;
      }
    }
  }
  while (i > 0) {
    ops.push(chalk.red(`- ${oldLines[i - 1]}`));
    i--;
  }
  while (j > 0) {
    ops.push(chalk.green(`+ ${newLines[j - 1]}`));
    j--;
  }
  return ops.reverse().join("\n");
}

function previewFor(comment: PRComment, diff: string): string {
  const header = `${chalk.bold(`Fix for comment ${comment.id}`)} on ${chalk.cyan(`${comment.file}:${comment.line}`)}`;
  const body = chalk.dim(comment.body);
  return `${header}\n${body}\n\n${diff}`;
}

async function readFileContent(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new CommentFixerError(
      `Failed to read ${filePath}: ${reason}. Verify the file exists at that path relative to the repo root and is readable.`,
    );
  }
}

async function writeFileContent(
  filePath: string,
  content: string,
): Promise<void> {
  try {
    await writeFile(filePath, content, "utf8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new CommentFixerError(
      `Failed to write ${filePath}: ${reason}. Check write permissions and that the directory still exists.`,
    );
  }
}

async function generateFix(
  ai: AIProvider,
  filePath: string,
  fileContent: string,
  comment: PRComment,
): Promise<string> {
  let raw: string;
  try {
    raw = await ai.complete(buildPrompt(filePath, fileContent, comment), {
      temperature: 0,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new CommentFixerError(
      `AI failed to generate a fix for comment ${comment.id}: ${reason}. Re-run, or switch providers/models in gpilot.config.yml.`,
    );
  }
  const cleaned = stripCodeFence(raw).trimEnd();
  if (!cleaned.trim()) {
    throw new CommentFixerError(
      `AI returned empty content for comment ${comment.id}. Re-run, or switch providers/models in gpilot.config.yml.`,
    );
  }
  return cleaned;
}

interface PendingFix {
  comment: PRComment;
  filePath: string;
  newContent: string;
}

async function decideFix(
  comment: PRComment,
  filePath: string,
  oldContent: string,
  newContent: string,
  confirmation: Confirmation,
  mode: ConfirmMode,
): Promise<
  { kind: "apply"; content: string } | { kind: "skip" } | { kind: "dryrun" }
> {
  const diff = unifiedDiff(oldContent, newContent);
  const preview = previewFor(comment, diff);

  if (mode === "dryrun") {
    await confirmation.ask({ mode, preview });
    return { kind: "dryrun" };
  }

  const result: ConfirmResult = await confirmation.ask({
    mode,
    preview,
    actions: ["yes", "no", "edit"],
  });

  if (result.action === "yes") {
    return { kind: "apply", content: newContent };
  }
  if (result.action === "edit") {
    const edited = result.editedText.trimEnd();
    if (!edited.trim()) {
      return { kind: "skip" };
    }
    return { kind: "apply", content: edited };
  }
  return { kind: "skip" };
}

async function commitAndPush(
  git: CommentFixerGitClient,
  files: string[],
  message: string,
): Promise<void> {
  try {
    await git.stage(files);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new CommentFixerError(
      `Failed to stage ${files.join(", ")}: ${reason}. Verify the files exist and the working tree is not locked.`,
    );
  }
  try {
    await git.commit(message);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new CommentFixerError(
      `Failed to commit fix: ${reason}. Resolve any pre-commit hook errors and re-run.`,
    );
  }
  let branch: string;
  try {
    branch = await git.getCurrentBranch();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new CommentFixerError(
      `Failed to read current branch: ${reason}. Ensure HEAD points to a branch (not detached) and re-run.`,
    );
  }
  if (!branch) {
    throw new CommentFixerError(
      "Cannot push from detached HEAD. Switch to the PR branch with git switch <branch> and re-run.",
    );
  }
  try {
    await git.push(branch);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new CommentFixerError(
      `Failed to push ${branch}: ${reason}. Check your remote and credentials, then re-run.`,
    );
  }
}

async function resolveComments(
  platform: GitPlatform,
  prId: string,
  commentIds: string[],
): Promise<void> {
  for (const id of commentIds) {
    try {
      await platform.resolveComment(prId, id);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new CommentFixerError(
        `Failed to resolve comment ${id} on PR ${prId}: ${reason}. Verify your platform credentials and that the comment is still open.`,
      );
    }
  }
}

async function fetchComment(
  platform: GitPlatform,
  prId: string,
  commentId: string,
): Promise<PRComment> {
  let comments: PRComment[];
  try {
    comments = await platform.getPRComments(prId);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new CommentFixerError(
      `Failed to fetch comments for PR ${prId}: ${reason}. Verify your platform credentials and that PR "${prId}" exists.`,
    );
  }
  const match = comments.find((c) => c.id === commentId);
  if (!match) {
    throw new CommentFixerError(
      `Comment ${commentId} not found in PR ${prId}. Re-run gpilot review to refresh comment ids, or pass a valid commentId.`,
    );
  }
  return match;
}

async function fetchBlockers(
  platform: GitPlatform,
  prId: string,
): Promise<PRComment[]> {
  let comments: PRComment[];
  try {
    comments = await platform.getPRComments(prId);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new CommentFixerError(
      `Failed to fetch comments for PR ${prId}: ${reason}. Verify your platform credentials and that PR "${prId}" exists.`,
    );
  }
  return comments.filter((c) => c.severity === "blocker");
}

/**
 * Construct a comment fixer wired to AI, git, a git platform, and a confirmation prompt.
 *
 * The returned object exposes a single `run()` method with two modes of operation:
 *
 *   - When `commentId` is provided, fetches that single comment, asks the AI for
 *     a complete file replacement, previews the diff, and on confirmation
 *     stages, commits, pushes, and resolves the comment. Editor edits are
 *     applied in place of the AI's output. A "no" response returns `'skipped'`
 *     with the comment id in `skippedComments`.
 *
 *   - When `commentId` is omitted, fetches all unresolved blocker-severity
 *     comments and runs the per-comment confirmation flow for each. All
 *     accepted fixes are bundled into a single commit (not one commit per
 *     fix), pushed once, and the corresponding comments are resolved.
 *     Returns `'fixed'` with an empty `fixedComments` when there are no
 *     blockers to address.
 *
 * Modes:
 *   - 'dryrun'      → preview every diff, never write/commit/push;
 *                     status `'dryrun'`
 *   - 'auto'        → skip prompts and apply every AI-suggested fix
 *   - 'interactive' → prompt the user per comment with yes/no/edit
 *
 * @param input - AI provider, git client (with stage and push), platform,
 *   confirmation helper, mode, PR id, and optional comment id
 * @returns an object with `run(): Promise<CommentFixerResult>`
 * @throws CommentFixerError when a comment is not found, file IO fails,
 *   the AI returns empty content, or any git/platform call fails
 */
export function createCommentFixer(input: CommentFixerInput): {
  run(): Promise<CommentFixerResult>;
} {
  const validated = inputSchema.parse(input);
  const { ai, git, platform, confirmation, mode, prId } = validated;
  const commentId = validated.commentId;

  return {
    async run(): Promise<CommentFixerResult> {
      const targets = commentId
        ? [await fetchComment(platform, prId, commentId)]
        : await fetchBlockers(platform, prId);

      if (targets.length === 0) {
        return { status: "fixed", fixedComments: [], skippedComments: [] };
      }

      const pending: PendingFix[] = [];
      const skipped: string[] = [];
      let sawDryrun = false;

      for (const comment of targets) {
        const oldContent = await readFileContent(comment.file);
        const aiContent = await generateFix(
          ai,
          comment.file,
          oldContent,
          comment,
        );

        if (aiContent === oldContent) {
          skipped.push(comment.id);
          continue;
        }

        const decision = await decideFix(
          comment,
          comment.file,
          oldContent,
          aiContent,
          confirmation,
          mode,
        );

        if (decision.kind === "dryrun") {
          sawDryrun = true;
          continue;
        }
        if (decision.kind === "skip") {
          skipped.push(comment.id);
          continue;
        }
        pending.push({
          comment,
          filePath: comment.file,
          newContent: decision.content,
        });
      }

      if (sawDryrun) {
        return {
          status: "dryrun",
          fixedComments: [],
          skippedComments: skipped,
        };
      }

      if (pending.length === 0) {
        return {
          status: "skipped",
          fixedComments: [],
          skippedComments: skipped,
        };
      }

      for (const fix of pending) {
        await writeFileContent(fix.filePath, fix.newContent);
      }

      const files = Array.from(new Set(pending.map((p) => p.filePath)));
      const ids = pending.map((p) => p.comment.id);
      const message =
        pending.length === 1
          ? `fix: address review comment ${ids[0]}`
          : `fix: address ${pending.length} review comments (${ids.join(", ")})`;

      await commitAndPush(git, files, message);
      await resolveComments(platform, prId, ids);

      return {
        status: "fixed",
        fixedComments: ids,
        skippedComments: skipped,
      };
    },
  };
}
