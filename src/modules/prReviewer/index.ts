import { z } from "zod";
import chalk from "chalk";
import type { AIProvider } from "../../core/ai/index.ts";
import type { GitClient } from "../../core/git/index.ts";
import type {
  Confirmation,
  ConfirmMode,
} from "../../core/confirmation/index.ts";
import type { GitPlatform as PrCreatorGitPlatform } from "../prCreator/index.ts";

export type IssueSeverity = "blocker" | "warning" | "info";

export interface InlineIssue {
  file: string;
  line: number;
  severity: IssueSeverity;
  comment: string;
  suggestedFix?: string;
}

export interface GitPlatform extends PrCreatorGitPlatform {
  getPRDiff(prId: string): Promise<string>;
  postInlineComment(prId: string, issue: InlineIssue): Promise<void>;
}

export interface ReviewRule {
  id: string;
  description: string;
  severity: IssueSeverity;
}

export interface PrReviewerInput {
  ai: AIProvider;
  git: GitClient;
  platform: GitPlatform;
  confirmation: Confirmation;
  mode: ConfirmMode;
  rules: ReviewRule[];
  prId?: string;
}

export interface PrReviewerResult {
  status: "posted" | "reviewed" | "cancelled" | "dryrun";
  issues: InlineIssue[];
}

export class PrReviewerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrReviewerError";
  }
}

const MAX_DIFF_CHARS = 60_000;

const DEFAULT_RULES: readonly ReviewRule[] = [
  {
    id: "no-console-logs",
    description: "Flag console.log calls left in production code.",
    severity: "warning",
  },
  {
    id: "no-hardcoded-secrets",
    description:
      "Flag API keys, tokens, passwords, or other secrets embedded directly in code.",
    severity: "blocker",
  },
  {
    id: "no-any-in-typescript",
    description: "Flag `: any` type annotations in TypeScript code.",
    severity: "warning",
  },
  {
    id: "tests-required",
    description:
      "Flag newly added exported functions that lack a matching test file.",
    severity: "info",
  },
  {
    id: "no-todo-comments",
    description: "Flag TODO and FIXME comments left in the diff.",
    severity: "info",
  },
];

const severitySchema = z.enum(["blocker", "warning", "info"]);

const reviewRuleSchema = z.object({
  id: z
    .string()
    .min(
      1,
      'rule id is empty. Set "id" to a non-empty string in gitpilot.config.yml.',
    ),
  description: z
    .string()
    .min(
      1,
      'rule description is empty. Set "description" to a non-empty string explaining what to flag.',
    ),
  severity: severitySchema,
});

const inlineIssueSchema = z.object({
  file: z
    .string()
    .min(
      1,
      'issue.file is empty. The AI must include the file path from the diff "+++ b/<path>" header.',
    ),
  line: z
    .number()
    .int("issue.line must be an integer line number from the new file version.")
    .positive(
      "issue.line must be > 0. Use the line number from the new file version.",
    ),
  severity: severitySchema,
  comment: z
    .string()
    .min(1, "issue.comment is empty. The AI must explain the problem."),
  suggestedFix: z.string().nullable().optional(),
});

const inputSchema = z.object({
  ai: z.custom<AIProvider>(
    (v) =>
      v !== null &&
      typeof v === "object" &&
      typeof (v as AIProvider).complete === "function",
    "ai must be an AIProvider. Build one with createAIProvider() from core/ai.",
  ),
  git: z.custom<GitClient>(
    (v) =>
      v !== null &&
      typeof v === "object" &&
      typeof (v as GitClient).getDiffAgainst === "function" &&
      typeof (v as GitClient).getDefaultBranch === "function",
    "git must be a GitClient. Build one with createGitClient() from core/git.",
  ),
  platform: z.custom<GitPlatform>(
    (v) =>
      v !== null &&
      typeof v === "object" &&
      typeof (v as GitPlatform).getPRDiff === "function" &&
      typeof (v as GitPlatform).postInlineComment === "function",
    "platform must be a GitPlatform with getPRDiff() and postInlineComment(). Build one with createGithubPlatform() or createAzureDevopsPlatform().",
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
  rules: z.array(reviewRuleSchema, {
    message:
      "rules must be an array of ReviewRule objects. Pass [] to use the built-in default rules.",
  }),
  prId: z
    .string()
    .min(
      1,
      "prId is empty. Pass a non-empty PR id to review a remote PR, or omit to review the local branch diff.",
    )
    .optional(),
});

function truncateDiff(diff: string): string {
  if (diff.length <= MAX_DIFF_CHARS) return diff;
  return `${diff.slice(0, MAX_DIFF_CHARS)}\n\n[diff truncated at ${MAX_DIFF_CHARS} chars]`;
}

function buildPrompt(diff: string, rules: readonly ReviewRule[]): string {
  const ruleBlock = rules
    .map((r) => `- ${r.id} (${r.severity}): ${r.description}`)
    .join("\n");
  // Strict prompt designed to survive small / local models (qwen-coder,
  // deepseek-coder, etc.). Pairing GOOD + BAD examples with numbered hard
  // rules empirically reduces malformed output (string-only arrays,
  // wrapper objects, prose acknowledgments) noticeably more than another
  // "do not" line.
  return (
    `Output a single JSON array of code-review issues. Nothing else.\n\n` +
    `STRICT OUTPUT RULES — violating any rule means the response is unusable:\n` +
    `1. Output is ONE JSON array. NO markdown, NO code fences, NO preface, NO trailing text.\n` +
    `2. Each element MUST be a JSON object with these EXACT fields:\n` +
    `   - "file": string — path from the diff "+++ b/<path>" header (no "b/" prefix)\n` +
    `   - "line": integer (> 0) — line number in the NEW version of the file\n` +
    `   - "severity": one of "blocker" | "warning" | "info" — match the rule's severity\n` +
    `   - "comment": string — explain the problem and why it matters\n` +
    `   - "suggestedFix": string (optional) — concrete replacement code or steps\n` +
    `3. Elements MUST be objects, NEVER plain strings.\n` +
    `4. Do NOT wrap the array in another object (no {"issues":[...]} or {"data":[...]}).\n` +
    `5. If no issues match the rules, return exactly: []\n` +
    `6. Only flag issues that match one of the rules below. Do NOT invent rules.\n\n` +
    `GOOD example (this is exactly the shape you must produce):\n` +
    `[{"file":"src/api/user.ts","line":47,"severity":"blocker","comment":"Unhandled promise rejection in fetchUser()","suggestedFix":"return res.json().catch(handleError)"}]\n\n` +
    `BAD examples (DO NOT do any of this):\n` +
    `- ["Issue: missing error handler at user.ts:47"]   ← strings instead of objects\n` +
    `- {"issues":[{...}]}                               ← wrapped in an object\n` +
    `- \`\`\`json\\n[...]\\n\`\`\`                      ← code-fenced\n` +
    `- {"response":"success"}                           ← acknowledgment instead of issues\n` +
    `- Here are the issues I found:\\n[...]              ← preface\n\n` +
    `Rules:\n${ruleBlock}\n\n` +
    `Diff:\n${truncateDiff(diff)}\n\n` +
    `Now return ONLY the JSON array — start with [ and end with ].`
  );
}

function stripCodeFence(raw: string): string {
  let text = raw.trim();
  // Strip ALL ```…``` fences anywhere in the response, not just at the start.
  // Small models often wrap a valid JSON array inside a fence somewhere in
  // the middle of explanatory text.
  const fenceMatch = text.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
  if (fenceMatch?.[1]) {
    const innerTrimmed = fenceMatch[1].trim();
    if (innerTrimmed.startsWith("[") || innerTrimmed.startsWith("{")) {
      return innerTrimmed;
    }
  }
  if (text.startsWith("```")) {
    text = text
      .replace(/^```[a-zA-Z]*\n?/, "")
      .replace(/\n?```\s*$/, "")
      .trim();
  }
  return text;
}

function extractJsonArray(text: string): string | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

const ARRAY_WRAPPER_KEYS = ["issues", "items", "data", "result", "results", "review", "comments"] as const;

function unwrapIssuesArray(parsed: unknown): unknown {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    for (const key of ARRAY_WRAPPER_KEYS) {
      const value = obj[key];
      if (Array.isArray(value)) return value;
    }
    // Single issue returned as a bare object — wrap it.
    if (typeof obj["file"] === "string" && (typeof obj["line"] === "number" || typeof obj["line"] === "string")) {
      return [obj];
    }
  }
  return parsed;
}

interface RescuedIssue {
  file?: unknown;
  line?: unknown;
  severity?: unknown;
  comment?: unknown;
  suggestedFix?: unknown;
}

function rescueIssue(raw: unknown): RescuedIssue | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const file =
    obj["file"] ?? obj["path"] ?? obj["filename"] ?? obj["filePath"];
  const lineRaw =
    obj["line"] ?? obj["lineNumber"] ?? obj["line_number"] ?? obj["lineNo"];
  const line =
    typeof lineRaw === "string" ? Number.parseInt(lineRaw, 10) : lineRaw;
  let severity = obj["severity"] ?? obj["level"] ?? obj["type"];
  if (typeof severity === "string") {
    const s = severity.toLowerCase();
    if (s === "error" || s === "critical" || s === "high") severity = "blocker";
    else if (s === "medium" || s === "warn") severity = "warning";
    else if (s === "low" || s === "note" || s === "hint") severity = "info";
    else severity = s;
  }
  const comment =
    obj["comment"] ?? obj["message"] ?? obj["description"] ?? obj["text"];
  const suggestedFix =
    obj["suggestedFix"] ?? obj["suggested_fix"] ?? obj["fix"] ?? obj["suggestion"];
  return { file, line, severity, comment, suggestedFix };
}

function parseIssues(raw: string): InlineIssue[] {
  const cleaned = stripCodeFence(raw);

  // Empty / acknowledgment-only response → treat as zero issues so the panel
  // shows a clean state rather than an error banner.
  const trimmedLower = cleaned.toLowerCase().trim();
  if (
    !trimmedLower ||
    /^(?:no\s+issues(?:\s+found)?|none|nothing(?:\s+to\s+report)?|all\s+good|ok|success)\.?$/.test(
      trimmedLower,
    )
  ) {
    return [];
  }

  // Try JSON array first, then a wrapper object with an array inside.
  const jsonArray = extractJsonArray(cleaned);
  const jsonObject = !jsonArray ? extractJsonObject(cleaned) : null;
  const jsonText = jsonArray ?? jsonObject;
  if (!jsonText) {
    throw new PrReviewerError(
      "AI did not return a JSON array of issues. Re-run, or switch providers/models in gitpilot.config.yml.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new PrReviewerError(
      `AI output was not valid JSON (${reason}). Re-run, or switch providers/models in gitpilot.config.yml.`,
    );
  }

  const unwrapped = unwrapIssuesArray(parsed);
  if (!Array.isArray(unwrapped)) {
    throw new PrReviewerError(
      `AI output was not a JSON array of issues (got ${typeof unwrapped}). Re-run, or switch providers/models in gitpilot.config.yml.`,
    );
  }

  // Drop any plain-string elements (some models summarize each issue as a
  // sentence instead of an object) — but record so we can warn the user
  // when *every* element was a string.
  const objectsOnly = unwrapped.filter(
    (e) => e !== null && typeof e === "object" && !Array.isArray(e),
  );
  if (objectsOnly.length === 0 && unwrapped.length > 0) {
    throw new PrReviewerError(
      `AI returned a list of strings instead of issue objects. Re-run, or switch to a stronger model in gitpilot.config.yml.`,
    );
  }

  const rescued = objectsOnly
    .map((e) => rescueIssue(e))
    .filter((e): e is RescuedIssue => e !== null);

  const result = z.array(inlineIssueSchema).safeParse(rescued);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.join(".") ?? "";
    const message = issue?.message ?? "invalid issue structure";
    throw new PrReviewerError(
      `AI output failed validation${path ? ` at "${path}"` : ""}: ${message}. Re-run, or switch providers/models in gitpilot.config.yml.`,
    );
  }
  return result.data.map((d) => {
    const issue: InlineIssue = {
      file: d.file,
      line: d.line,
      severity: d.severity,
      comment: d.comment,
    };
    if (typeof d.suggestedFix === "string") {
      issue.suggestedFix = d.suggestedFix;
    }
    return issue;
  });
}

function severityCounts(issues: InlineIssue[]): {
  blockers: number;
  warnings: number;
  infos: number;
} {
  let blockers = 0;
  let warnings = 0;
  let infos = 0;
  for (const i of issues) {
    if (i.severity === "blocker") blockers++;
    else if (i.severity === "warning") warnings++;
    else infos++;
  }
  return { blockers, warnings, infos };
}

function summarize(issues: InlineIssue[]): string {
  const { blockers, warnings, infos } = severityCounts(issues);
  const header = `${issues.length} issues found (${blockers} blockers, ${warnings} warnings, ${infos} infos)`;
  const lines = issues.map((i) => {
    const head = `[${i.severity}] ${i.file}:${i.line} — ${i.comment}`;
    return i.suggestedFix ? `${head}\n  fix: ${i.suggestedFix}` : head;
  });
  return [header, "", ...lines].join("\n");
}

interface EnquirerLike {
  prompt(options: unknown): Promise<Record<string, unknown>>;
}

let enquirerPromise: Promise<EnquirerLike | null> | null = null;

async function loadEnquirer(): Promise<EnquirerLike | null> {
  if (enquirerPromise) return enquirerPromise;
  enquirerPromise = (async () => {
    try {
      const mod = (await import("enquirer")) as
        | EnquirerLike
        | { default: EnquirerLike };
      return "default" in mod && mod.default
        ? mod.default
        : (mod as EnquirerLike);
    } catch {
      return null;
    }
  })();
  return enquirerPromise;
}

type PostChoice = "yes" | "select" | "no";

async function askPostChoice(): Promise<PostChoice> {
  const enquirer = await loadEnquirer();
  if (!enquirer) return "no";
  try {
    const response = await enquirer.prompt({
      type: "select",
      name: "choice",
      message: chalk.cyan("Post issues as inline comments?"),
      choices: [
        { name: "yes", message: "post all issues" },
        { name: "select", message: "select which to post" },
        { name: "no", message: "do not post" },
      ],
    });
    const v = response["choice"];
    if (v === "yes" || v === "select" || v === "no") return v;
    return "no";
  } catch {
    return "no";
  }
}

async function selectIssues(issues: InlineIssue[]): Promise<InlineIssue[]> {
  const enquirer = await loadEnquirer();
  if (!enquirer) return [];
  try {
    const response = await enquirer.prompt({
      type: "multiselect",
      name: "selected",
      message: chalk.cyan(
        "Toggle which issues to post (space to select, enter to confirm)",
      ),
      choices: issues.map((i, idx) => ({
        name: String(idx),
        message: `[${i.severity}] ${i.file}:${i.line} — ${i.comment}`,
        value: String(idx),
      })),
    });
    const selected = response["selected"];
    if (!Array.isArray(selected)) return [];
    return selected
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n) && n >= 0 && n < issues.length)
      .map((n) => issues[n] as InlineIssue);
  } catch {
    return [];
  }
}

async function postAll(
  platform: GitPlatform,
  prId: string,
  issues: InlineIssue[],
): Promise<void> {
  for (const issue of issues) {
    try {
      await platform.postInlineComment(prId, issue);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new PrReviewerError(
        `Failed to post inline comment on ${issue.file}:${issue.line}: ${reason}. Verify your platform credentials and that PR "${prId}" exists and is open.`,
      );
    }
  }
}

/**
 * Construct a PR reviewer wired to AI, git, a git platform, and a confirmation prompt.
 *
 * The returned object exposes a single `run()` method that:
 *   1. fetches the diff (from `platform.getPRDiff(prId)` if `prId` is provided,
 *      otherwise locally via `git.getDiffAgainst(defaultBranch)`),
 *   2. asks the AI for inline issues that match the configured review rules
 *      (or the built-in defaults when `rules` is empty),
 *   3. validates each issue's structure (file, line, severity, comment),
 *   4. previews a severity-aware summary, and
 *   5. when `prId` is set, optionally posts each issue via
 *      `platform.postInlineComment`.
 *
 * Modes:
 *   - 'dryrun'      → preview the issues, do not post; status `'dryrun'`
 *   - 'auto'        → with `prId`, post all issues unattended (status `'posted'`);
 *                     without `prId`, return the issues (status `'reviewed'`)
 *   - 'interactive' → prompt the user to post all, select a subset, or skip
 *
 * An empty diff or zero issues short-circuit to status `'reviewed'` with an
 * empty `issues` array.
 *
 * @param input - AI provider, git client, platform, confirmation helper, mode,
 *   review rules (pass `[]` for defaults), and optional PR id
 * @returns an object with `run(): Promise<PrReviewerResult>`
 * @throws PrReviewerError when the AI output cannot be parsed or validated,
 *   or when a `postInlineComment` call fails
 */
export function createPrReviewer(input: PrReviewerInput): {
  run(): Promise<PrReviewerResult>;
} {
  const validated = inputSchema.parse(input);
  const { ai, git, platform, confirmation, mode } = validated;
  const rules = validated.rules.length > 0 ? validated.rules : DEFAULT_RULES;
  const prId = validated.prId;

  return {
    async run(): Promise<PrReviewerResult> {
      const diff = prId
        ? await platform.getPRDiff(prId)
        : await git.getDiffAgainst(await git.getDefaultBranch());

      if (!diff.trim()) {
        return { status: "reviewed", issues: [] };
      }

      const raw = await ai.complete(buildPrompt(diff, rules), {
        temperature: 0,
      });
      const issues = parseIssues(raw);

      if (issues.length === 0) {
        return { status: "reviewed", issues: [] };
      }

      const preview = summarize(issues);

      if (mode === "dryrun") {
        await confirmation.ask({ mode, preview });
        return { status: "dryrun", issues };
      }

      process.stdout.write(`${preview}\n`);

      if (!prId) {
        return { status: "reviewed", issues };
      }

      if (mode === "auto") {
        await postAll(platform, prId, issues);
        return { status: "posted", issues };
      }

      const choice = await askPostChoice();
      if (choice === "no") {
        return { status: "reviewed", issues };
      }

      const toPost = choice === "select" ? await selectIssues(issues) : issues;
      if (toPost.length === 0) {
        return { status: "reviewed", issues };
      }
      await postAll(platform, prId, toPost);
      return { status: "posted", issues: toPost };
    },
  };
}
