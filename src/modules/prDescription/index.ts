import { z } from "zod";
import type { AIProvider } from "../../core/ai/index.ts";
import type { GitClient } from "../../core/git/index.ts";
import type {
  Confirmation,
  ConfirmMode,
  ConfirmResult,
} from "../../core/confirmation/index.ts";

export interface PrDescriptionInput {
  ai: AIProvider;
  git: GitClient;
  confirmation: Confirmation;
  mode: ConfirmMode;
  template?: string;
}

export interface PrDescriptionResult {
  status: "generated" | "cancelled" | "dryrun";
  title?: string;
  body?: string;
}

export class PrDescriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrDescriptionError";
  }
}

const RECENT_COMMIT_COUNT = 3;
const TITLE_MAX_LENGTH = 100;
const MAX_DIFF_CHARS = 60_000;
const MAX_FILES_LISTED = 50;

const DEFAULT_TEMPLATE = [
  "## Summary",
  "<one short paragraph describing what this PR does and why>",
  "",
  "## Changes",
  "- <bullet for each meaningful change>",
  "",
  "## Testing",
  "- <how this was tested or how a reviewer can verify>",
  "",
  "## Notes",
  "- <risks, follow-ups, or anything reviewers should pay attention to>",
].join("\n");

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
      typeof (v as GitClient).getDiffAgainst === "function",
    "git must be a GitClient. Build one with createGitClient() from core/git.",
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
  template: z
    .string()
    .min(
      1,
      "template is empty. Pass a non-empty markdown string or omit to use the default template.",
    )
    .optional(),
});

function truncateDiff(diff: string): string {
  if (diff.length <= MAX_DIFF_CHARS) return diff;
  return `${diff.slice(0, MAX_DIFF_CHARS)}\n\n[diff truncated at ${MAX_DIFF_CHARS} chars]`;
}

function formatFiles(files: string[]): string {
  if (files.length === 0) return "(no files changed)";
  const listed = files.slice(0, MAX_FILES_LISTED).map((f) => `- ${f}`);
  if (files.length > MAX_FILES_LISTED) {
    listed.push(`- ...and ${files.length - MAX_FILES_LISTED} more`);
  }
  return listed.join("\n");
}

function buildPrompt(
  diff: string,
  files: string[],
  recentMessages: string[],
  template: string,
): string {
  const recentBlock = recentMessages.length
    ? `Recent commits on this branch (use them as the source of truth for intent):\n${recentMessages
        .map((m) => `- ${m}`)
        .join("\n")}\n\n`
    : "";
  // Strict prompt designed for small / local models (qwen-coder, deepseek-coder,
  // etc.) that frequently violate output constraints. Pairing a positive
  // example with an explicit BAD example reduces wrapper / acknowledgment
  // responses noticeably more than another rule line.
  return (
    `Output a single JSON object describing a pull request. Nothing else.\n\n` +
    `STRICT OUTPUT RULES — violating any rule means the response is unusable:\n` +
    `1. Output is ONE JSON object on the first line. NO markdown, NO code fences, NO preface.\n` +
    `2. The JSON must have EXACTLY two top-level string fields: "title" and "body". Both are MANDATORY.\n` +
    `3. Do NOT nest the fields under another key (no "pr", "data", "result").\n` +
    `4. Do NOT acknowledge the request ({"response":"success"} is INVALID).\n` +
    `5. Do NOT add any explanation, commentary, or trailing text after the JSON.\n` +
    `6. "title": imperative mood, <= ${TITLE_MAX_LENGTH} chars, no trailing period, no PR number prefix.\n` +
    `7. "body": GitHub-flavored markdown matching the template below. Each section paragraph is a real description, not a placeholder. Drop any section that has no content.\n\n` +
    `GOOD example (this is exactly the shape you must produce):\n` +
    `{"title":"feat(auth): add OAuth2 token refresh","body":"## Summary\\nAdds automatic token refresh on 401.\\n\\n## Changes\\n- Refresh tokens with exponential backoff"}\n\n` +
    `BAD examples (DO NOT do any of this):\n` +
    `- {"response":"success"}\n` +
    `- \`\`\`json\\n{"title":"…","body":"…"}\\n\`\`\`\n` +
    `- Here is the PR description:\\n{"title":"…","body":"…"}\n` +
    `- {"pr":{"title":"…","body":"…"}}\n\n` +
    `Template for the body field:\n${template}\n\n` +
    recentBlock +
    `Files changed:\n${formatFiles(files)}\n\n` +
    `Diff:\n${truncateDiff(diff)}\n\n` +
    `Now return ONLY the JSON object.`
  );
}

function stripCodeFence(raw: string): string {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text
      .replace(/^```[a-zA-Z]*\n?/, "")
      .replace(/```\s*$/, "")
      .trim();
  }
  return text;
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

const TITLE_KEYS = ["title", "pr_title", "prTitle", "name", "summary", "subject"] as const;
const BODY_KEYS = [
  "body",
  "description",
  "pr_body",
  "prBody",
  "content",
  "details",
  "response", // Ollama / OpenAI-compat wrappers often nest the real answer here
  "text",
  "message",
] as const;

// Short throwaway phrases small models return instead of doing the work.
// If we see one of these as the only payload, we treat the response as
// useless and ask the user to regenerate rather than committing it as content.
const ACKNOWLEDGMENT_VALUES = new Set([
  "success",
  "ok",
  "okay",
  "done",
  "complete",
  "completed",
  "yes",
  "true",
]);

function looksLikeAcknowledgment(value: string): boolean {
  const stripped = value.trim().toLowerCase().replace(/[.!]+$/, "");
  return stripped.length <= 12 && ACKNOWLEDGMENT_VALUES.has(stripped);
}

function pickStringField(obj: Record<string, unknown>, keys: ReadonlyArray<string>): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function deriveTitleFromBody(body: string, recentMessages: string[]): string {
  // Prefer the first markdown heading, then the first non-empty line, then
  // the first recent commit's first line as a last resort.
  for (const line of body.split("\n")) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading?.[1]) return heading[1].slice(0, TITLE_MAX_LENGTH);
  }
  const firstLine = body.split("\n").find((l) => l.trim().length > 0);
  if (firstLine) return firstLine.trim().slice(0, TITLE_MAX_LENGTH);
  const firstCommit = recentMessages[0]?.split("\n")[0]?.trim();
  if (firstCommit) return firstCommit.slice(0, TITLE_MAX_LENGTH);
  return "";
}

function parseFreeformMarkdown(text: string): { title: string; body: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const lines = trimmed.split("\n");
  // First non-empty line becomes the title (stripping leading `#` markers).
  const firstIdx = lines.findIndex((l) => l.trim().length > 0);
  if (firstIdx === -1) return null;
  const titleLine = lines[firstIdx]!.replace(/^#{1,6}\s*/, "").trim();
  if (!titleLine) return null;
  const body = lines.slice(firstIdx + 1).join("\n").trim();
  return {
    title: titleLine.slice(0, TITLE_MAX_LENGTH),
    body: body || titleLine,
  };
}

function parseOutput(
  raw: string,
  recentMessages: string[],
): { title: string; body: string } {
  const cleaned = stripCodeFence(raw).trim();
  if (!cleaned) {
    throw new PrDescriptionError(
      "AI returned an empty response. Choose regenerate, or use edit to write the description manually.",
    );
  }

  // 1) Try strict JSON parse. Small local models often skip a key, use a
  //    different key name, or wrap the JSON in prose — handle each case.
  const json = extractJsonObject(cleaned);
  let jsonParsedSuccessfully = false;
  let parsedKeys: string[] = [];
  if (json) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
      jsonParsedSuccessfully = true;
    } catch {
      parsed = null;
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      parsedKeys = Object.keys(obj);
      let title = pickStringField(obj, TITLE_KEYS);
      let body = pickStringField(obj, BODY_KEYS);
      // Some models nest both fields under a single key like "pr" or "data".
      if (!title || !body) {
        for (const wrapper of ["pr", "pull_request", "data", "result"]) {
          const inner = obj[wrapper];
          if (inner && typeof inner === "object" && !Array.isArray(inner)) {
            const innerObj = inner as Record<string, unknown>;
            if (!title) title = pickStringField(innerObj, TITLE_KEYS);
            if (!body) body = pickStringField(innerObj, BODY_KEYS);
          }
        }
      }
      // Reject acknowledgment-only payloads like {"response":"success"} — the
      // model didn't actually produce anything, so committing it as the body
      // would just write garbage into the PR description.
      if (body && looksLikeAcknowledgment(body) && !title) {
        throw new PrDescriptionError(
          `AI returned an acknowledgment ("${body.trim()}") instead of a PR description. ` +
            `This usually means the model ignored the JSON schema. Choose regenerate, ` +
            `switch to a stronger model, or use edit.`,
        );
      }
      if (!title && body) title = deriveTitleFromBody(body, recentMessages);
      if (title && !body) body = title;
      if (title && body) {
        if (title.length > TITLE_MAX_LENGTH) title = title.slice(0, TITLE_MAX_LENGTH);
        return { title, body };
      }
    }
  }

  // 2) Freeform fallback — only when JSON parsing failed entirely. If the
  //    model returned a JSON object that just didn't have the right keys,
  //    falling back to "treat the literal JSON string as markdown" produces
  //    garbage like a PR titled `{"response":"success"}`. Surface a real
  //    error in that case so the user can regenerate.
  if (!jsonParsedSuccessfully) {
    const freeform = parseFreeformMarkdown(cleaned);
    if (freeform) return freeform;
  }

  const keysHint =
    parsedKeys.length > 0
      ? ` (model returned keys: ${parsedKeys.map((k) => `"${k}"`).join(", ")})`
      : "";
  throw new PrDescriptionError(
    `AI did not return a usable title or body${keysHint}. Choose regenerate, switch to a stronger model, or use edit to write the description manually.`,
  );
}

function renderPreview(title: string, body: string): string {
  return `${title}\n\n${body}`;
}

function parseEdited(text: string): { title: string; body: string } {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new PrDescriptionError(
      "Edited PR description is empty. Re-run the command and provide a title on the first line and body below.",
    );
  }
  const newlineIndex = trimmed.indexOf("\n");
  if (newlineIndex === -1) {
    return { title: trimmed, body: "" };
  }
  const title = trimmed.slice(0, newlineIndex).trim();
  const body = trimmed.slice(newlineIndex + 1).trim();
  if (!title) {
    throw new PrDescriptionError(
      "Edited PR description has no title on the first line. Put the PR title on line 1 and the body on line 3 onward.",
    );
  }
  return { title, body };
}

/**
 * Construct a PR description generator wired to AI, git, and a confirmation prompt.
 *
 * The returned object exposes a single `run()` method that:
 *   1. resolves the current and default branches (errors if they match),
 *   2. reads the diff and changed file list against the default branch,
 *   3. samples the last 3 commit messages for intent,
 *   4. asks the AI for a JSON {title, body} following the template, and
 *   5. shows the rendered preview via the confirmation module.
 *
 * On `yes` returns the generated title/body; on `edit` returns the edited
 * version (title parsed from the first line); on `regenerate` loops back
 * and re-asks the AI; on `no` returns cancelled. In `dryrun` mode the
 * description is generated and previewed but `status` is `'dryrun'`;
 * in `auto` mode the prompt is skipped and the result is returned as
 * `'generated'` unattended.
 *
 * @param input - AI provider, git client, confirmation helper, mode, and optional template override
 * @returns an object with `run(): Promise<PrDescriptionResult>`
 * @throws PrDescriptionError when run from the default branch, the diff is empty, or the AI output is unusable
 */
export function createPrDescription(input: PrDescriptionInput): {
  run(): Promise<PrDescriptionResult>;
} {
  const validated = inputSchema.parse(input);
  const { ai, git, confirmation, mode } = validated;
  const template = validated.template ?? DEFAULT_TEMPLATE;

  return {
    async run(): Promise<PrDescriptionResult> {
      const [currentBranch, defaultBranch] = await Promise.all([
        git.getCurrentBranch(),
        git.getDefaultBranch(),
      ]);

      if (!currentBranch) {
        throw new PrDescriptionError(
          "Not on a branch (detached HEAD). Check out a feature branch with git switch <branch>.",
        );
      }

      if (currentBranch === defaultBranch) {
        throw new PrDescriptionError(
          "Cannot generate PR description from default branch.",
        );
      }

      const [diff, files, recent] = await Promise.all([
        git.getDiffAgainst(defaultBranch),
        git.getChangedFiles(defaultBranch),
        git.getRecentCommits(RECENT_COMMIT_COUNT),
      ]);

      if (!diff.trim()) {
        throw new PrDescriptionError(
          `No changes between ${defaultBranch} and ${currentBranch}. Commit your work before generating a PR description.`,
        );
      }

      const recentMessages = recent.map((c) => c.message);

      while (true) {
        const prompt = buildPrompt(diff, files, recentMessages, template);
        const raw = await ai.complete(prompt, { temperature: 0.2 });
        const { title, body } = parseOutput(raw, recentMessages);

        if (mode === "dryrun") {
          await confirmation.ask({ mode, preview: renderPreview(title, body) });
          return { status: "dryrun", title, body };
        }

        const result: ConfirmResult = await confirmation.ask({
          mode,
          preview: renderPreview(title, body),
          actions: ["yes", "no", "edit", "regenerate"],
        });

        if (result.action === "yes") {
          return { status: "generated", title, body };
        }

        if (result.action === "edit") {
          const edited = parseEdited(result.editedText);
          return {
            status: "generated",
            title: edited.title,
            body: edited.body,
          };
        }

        if (result.action === "regenerate") {
          continue;
        }

        return { status: "cancelled" };
      }
    },
  };
}
