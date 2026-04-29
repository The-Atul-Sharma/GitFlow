import { z } from "zod";
import type { AIProvider } from "../../core/ai/index.ts";
import type { GitClient } from "../../core/git/index.ts";
import type {
  Confirmation,
  ConfirmMode,
  ConfirmResult,
} from "../../core/confirmation/index.ts";

export interface CommitGeneratorInput {
  ai: AIProvider;
  git: GitClient;
  confirmation: Confirmation;
  mode: ConfirmMode;
  shouldCreateCommit?: boolean;
}

export interface CommitGeneratorResult {
  status: "committed" | "cancelled" | "dryrun";
  message?: string;
}

export class CommitGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommitGenerationError";
  }
}

const RECENT_COMMIT_COUNT = 5;
const HEADER_MAX_LENGTH = 100;

const CONVENTIONAL_TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
] as const;

const HEADER_PATTERN = new RegExp(
  `^(${CONVENTIONAL_TYPES.join("|")})(\\([^)]+\\))?!?: \\S.*`,
);

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
      typeof (v as GitClient).getStagedDiff === "function",
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
  shouldCreateCommit: z.boolean().optional(),
});

function buildPrompt(diff: string, recentMessages: string[]): string {
  const recentBlock = recentMessages.length
    ? `Recent commit messages on this branch (match their tone and style):\n${recentMessages
        .map((m) => `- ${m}`)
        .join("\n")}\n\n`
    : "";
  return (
    `You are a senior engineer writing a Conventional Commit message.\n\n` +
    `Rules:\n` +
    `- First line: <type>(<scope>)?: <subject>\n` +
    `- Allowed types: ${CONVENTIONAL_TYPES.join(", ")}\n` +
    `- HARD LIMIT: first line must be <= ${HEADER_MAX_LENGTH} characters\n` +
    `- If needed, shorten the subject so the first line fits <= ${HEADER_MAX_LENGTH}\n` +
    `- Subject: imperative mood, lowercase, no trailing period, <= 72 chars\n` +
    `- Optional body: blank line after header, wrap at 72 chars, explain *why*\n` +
    `- No code fences, no surrounding quotes, no preface\n\n` +
    recentBlock +
    `Staged diff:\n${diff}\n\n` +
    `Return ONLY the commit message.`
  );
}

function scopeFromPath(path: string): string {
  const clean = path.replace(/^\.?\//, "");
  const parts = clean.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return "root";
  if (parts[0] === "src") {
    const srcParts = parts.slice(1);
    if (srcParts[0] === "packages" && srcParts[1]) {
      return `packages/${srcParts[1]}`;
    }
    return srcParts[0] ?? "src";
  }
  if (parts[0] === "specs") return "specs";
  return parts[0] ?? "root";
}

function decideCommitScope(stagedFiles: string[]): string | null {
  if (stagedFiles.length === 0) return null;
  const counts = new Map<string, number>();
  for (const file of stagedFiles) {
    const scope = scopeFromPath(file);
    counts.set(scope, (counts.get(scope) ?? 0) + 1);
  }
  let winnerScope = "";
  let winnerCount = 0;
  for (const [scope, count] of counts.entries()) {
    if (count > winnerCount) {
      winnerScope = scope;
      winnerCount = count;
    }
  }
  if (winnerCount === 0) return null;
  if (stagedFiles.length === 1) return winnerScope;
  const ratio = winnerCount / stagedFiles.length;
  return ratio >= 0.7 ? winnerScope : null;
}

function buildPromptWithScope(
  diff: string,
  recentMessages: string[],
  requiredScope: string | null,
): string {
  const scopeRule =
    requiredScope === null
      ? '- Scope policy: omit scope when changes span multiple areas. Use "<type>: <subject>"\n'
      : `- Scope policy: use scope "${requiredScope}" exactly. Use "<type>(${requiredScope}): <subject>"\n`;
  const recentBlock = recentMessages.length
    ? `Recent commit messages on this branch (match their tone and style):\n${recentMessages
        .map((m) => `- ${m}`)
        .join("\n")}\n\n`
    : "";
  // Strict prompt designed to survive small / local models (qwen-coder,
  // deepseek-coder, etc.). These models love to wrap output in code fences
  // and add explanations even when told not to. The negative example below
  // shows them what NOT to do, which empirically helps more than another
  // "do not" rule.
  const exampleScope = requiredScope ?? "auth";
  return (
    `Output a single Conventional Commit message. Nothing else.\n\n` +
    `STRICT OUTPUT RULES — violating any rule means the response is unusable:\n` +
    `1. Output is plain text only. NO markdown, NO code fences (no \`\`\`), NO blockquotes.\n` +
    `2. NO preface ("Here is...", "Sure!", "Of course"). Start with the type.\n` +
    `3. NO trailing explanation, commentary, or notes after the message.\n` +
    `4. NO surrounding quotes.\n` +
    `5. First line format: <type>(<scope>)?: <subject>\n` +
    `6. Allowed types: ${CONVENTIONAL_TYPES.join(", ")}\n` +
    `${scopeRule}` +
    `7. First line MUST be <= ${HEADER_MAX_LENGTH} characters total.\n` +
    `8. Subject: imperative mood, lowercase, no trailing period, <= 72 chars.\n` +
    `9. Optional body: one blank line after header, wrap at 72 chars, explain *why*.\n\n` +
    `GOOD example (this is exactly the shape you must produce):\n` +
    `feat(${exampleScope}): add token refresh on 401\n\n` +
    `Refresh tokens silently before the next request to avoid logging the user out.\n\n` +
    `BAD example (DO NOT do this — wrapping, prefaces, fences, trailing notes):\n` +
    `Here is the commit message:\n` +
    `\`\`\`\n` +
    `feat(${exampleScope}): add token refresh on 401\n` +
    `\`\`\`\n` +
    `This commit adds...\n\n` +
    recentBlock +
    `Staged diff:\n${diff}\n\n` +
    `Now return ONLY the commit message — start with the type, no fences, no preface, no trailing text.`
  );
}

// Match a Conventional Commit header at the START of a line (anchored).
const CONVENTIONAL_HEADER_RE = new RegExp(
  `^(${CONVENTIONAL_TYPES.join("|")})(\\([^)]+\\))?!?:\\s+\\S.*`,
  "m",
);

function extractInnerFencedMessage(text: string): string | null {
  // qwen-coder / deepseek-coder commonly produce:
  //   feat(scope): Here is the commit:
  //   ```plaintext
  //   feat(scope): real subject
  //   ```
  //   Then explanation text...
  // When that happens, the only trustworthy commit message is what's inside
  // the fence — the wrapping line is the model's preface and the trailing
  // text is its commentary.
  const fenceRe = /```[a-zA-Z]*\n([\s\S]*?)```/;
  const match = text.match(fenceRe);
  if (!match || !match[1]) return null;
  const inner = match[1].trim();
  if (!inner) return null;
  // Only prefer the fenced content if it actually starts with a Conventional
  // Commit header — otherwise the fence is unrelated (e.g., the AI showed a
  // diff or example).
  if (CONVENTIONAL_HEADER_RE.test(inner)) return inner;
  return null;
}

function stripTrailingProse(message: string): string {
  // After the header (and optional body), small models often append a
  // "This commit ..." or "Note: ..." paragraph explaining what they wrote.
  // The Conventional Commit spec allows a body separated from the header by
  // a blank line. We keep the header and any body up until the first
  // paragraph that *itself* looks like prose about the commit, then stop.
  const lines = message.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    // Detect explanatory closers and stop including from there on.
    if (
      /^(this\s+commit|the\s+(first|message|commit)|note:|explanation:|here['']s\s+why|i\s+(have|hope))/i.test(
        trimmed,
      )
    ) {
      break;
    }
    out.push(line);
  }
  return out.join("\n").trimEnd();
}

function cleanMessage(raw: string): string {
  let text = raw.trim();

  // 1) If the model wrapped the real message inside a fenced block (with
  //    surrounding prose), prefer the fenced content.
  const inner = extractInnerFencedMessage(text);
  if (inner) {
    text = inner;
  } else if (text.startsWith("```")) {
    // Whole response is a single fenced block — strip the fence wrapper.
    text = text
      .replace(/^```[a-zA-Z]*\n?/, "")
      .replace(/\n?```\s*$/, "")
      .trim();
  }

  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim();
  }

  // 2) Strip conversational prefaces small/local models often add even when
  //    told not to: "Here's the commit message:\n…", "Sure! Here is:\n…", etc.
  const prefacePatterns = [
    /^(?:sure[,!.]?\s*)?here(?:'s|\s+is)\s+(?:the\s+)?(?:conventional\s+)?(?:commit\s+message|commit|message)[^\n:]*[:\-]?\s*\n+/i,
    /^commit\s+message[:\s-]*\n+/i,
    /^message[:\s-]*\n+/i,
    /^(?:of\s+course[,!.]?\s*|certainly[,!.]?\s*|absolutely[,!.]?\s*)/i,
  ];
  for (const pattern of prefacePatterns) {
    text = text.replace(pattern, "").trim();
  }

  // 3) If the model started the response with a Conventional header line
  //    that itself contains "Here is..." (i.e. "feat(scope): Here is the
  //    commit message based on..."), and there's a real commit header
  //    anywhere later in the response, prefer the later one.
  const firstLine = text.split("\n", 1)[0] ?? "";
  if (
    /\b(here\s+is|here['']s|based\s+on|the\s+following|note that)\b/i.test(firstLine)
  ) {
    const lines = text.split("\n");
    const realHeaderIdx = lines.findIndex(
      (line, i) => i > 0 && CONVENTIONAL_HEADER_RE.test(line.trim()),
    );
    if (realHeaderIdx !== -1) {
      text = lines.slice(realHeaderIdx).join("\n").trim();
    }
  }

  // 4) Drop trailing explanatory prose ("This commit updates...", etc.).
  text = stripTrailingProse(text);

  return text;
}

function lowercaseType(message: string): string {
  const [header = "", ...rest] = message.split("\n");
  const lowered = header.replace(
    /^([A-Z][a-z]+)(\([^)]+\))?(!?:\s+)/,
    (_, type: string, scope: string | undefined, sep: string) =>
      `${type.toLowerCase()}${scope ?? ""}${sep}`,
  );
  return [lowered, ...rest].join("\n");
}

function ensureConventionalPrefix(message: string): string {
  const [header = "", ...rest] = message.split("\n");
  if (HEADER_PATTERN.test(header.trim())) return message;
  // No recognized type prefix — infer one from the subject text.
  const subject = header.trim();
  if (!subject) return message;
  const inferred = inferType(subject);
  return [`${inferred}: ${subject}`, ...rest].join("\n");
}

function inferType(subject: string): (typeof CONVENTIONAL_TYPES)[number] {
  const lower = subject.toLowerCase();
  if (/(^|\s)(fix|bug|patch|resolve)(\s|$)/.test(lower)) return "fix";
  if (/(^|\s)(doc|docs|readme|comment)/.test(lower)) return "docs";
  if (/(^|\s)(test|spec)/.test(lower)) return "test";
  if (/(^|\s)(refactor|rename|move|extract|inline|cleanup)/.test(lower)) return "refactor";
  if (/(^|\s)(perf|optimi[sz]e|speed)/.test(lower)) return "perf";
  if (/(^|\s)(build|ci|deploy|release|version|bump)/.test(lower))
    return lower.includes("ci") ? "ci" : "build";
  if (/(^|\s)(chore|update|upgrade)/.test(lower)) return "chore";
  return "feat";
}

function normalizeHeader(header: string): string {
  return header.replace(
    /^((?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\([^)]+\))?!?)\s+-\s+(\S.*)$/,
    "$1: $2",
  );
}

function normalizeMessage(message: string): string {
  const [header = "", ...rest] = message.split("\n");
  const normalizedHeader = normalizeHeader(header.trim());
  return [normalizedHeader, ...rest].join("\n").trim();
}

function truncateHeaderToMaxLength(message: string): string {
  const [header = "", ...rest] = message.split("\n");
  if (header.length <= HEADER_MAX_LENGTH) return message;
  const match = header.match(
    /^((?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\([^)]+\))?!?: )(\S.*)$/,
  );
  if (!match) return message;
  const prefix = match[1] ?? "";
  const subject = match[2] ?? "";
  const maxSubjectLength = HEADER_MAX_LENGTH - prefix.length;
  if (maxSubjectLength <= 0) return message;
  if (subject.length <= maxSubjectLength) return message;
  const hardSlice = subject.slice(0, maxSubjectLength).trimEnd();
  const lastSpace = hardSlice.lastIndexOf(" ");
  const shortened =
    lastSpace >= Math.floor(maxSubjectLength * 0.6)
      ? hardSlice.slice(0, lastSpace).trimEnd()
      : hardSlice;
  const rebuiltHeader = `${prefix}${shortened}`;
  return [rebuiltHeader, ...rest].join("\n").trim();
}

function enforceScopePolicy(
  message: string,
  requiredScope: string | null,
): string {
  const [header = "", ...rest] = message.split("\n");
  const match = header.match(
    /^((?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert))(?:\(([^)]+)\))?(!?):\s+(\S.*)$/,
  );
  if (!match) return message;
  const type = match[1] ?? "";
  const bang = match[3] ?? "";
  const subject = match[4] ?? "";
  const scopedHeader =
    requiredScope === null
      ? `${type}${bang}: ${subject}`
      : `${type}(${requiredScope})${bang}: ${subject}`;
  return [scopedHeader, ...rest].join("\n").trim();
}

function validateMessage(message: string): void {
  if (!message) {
    throw new CommitGenerationError(
      "AI returned an empty commit message. Choose regenerate, or switch providers/models in gitpilot.config.yml.",
    );
  }
  const header = message.split("\n", 1)[0] ?? "";
  if (!header.trim()) {
    throw new CommitGenerationError(
      "AI returned a commit message with no header line. Choose regenerate, or use edit to write one.",
    );
  }
  if (header.length > HEADER_MAX_LENGTH) {
    throw new CommitGenerationError(
      `Commit header is ${header.length} chars (max ${HEADER_MAX_LENGTH}). Choose regenerate, or shorten via edit.`,
    );
  }
  if (!HEADER_PATTERN.test(header)) {
    throw new CommitGenerationError(
      `Commit header "${header}" is not Conventional Commits "<type>(<scope>)?: <subject>". Choose regenerate, or fix via edit.`,
    );
  }
}

/**
 * Construct a commit-message generator wired to AI, git, and a confirmation prompt.
 *
 * The returned object exposes a single `run()` method that:
 *   1. reads the staged diff (errors if empty),
 *   2. samples recent commit messages for tone,
 *   3. asks the AI for a Conventional Commit message,
 *   4. shows it via the confirmation module, and
 *   5. on yes/edit writes the message via `git.setCommitMessage`; on regenerate loops; on no cancels.
 *
 * In `dryrun` mode the message is generated and previewed but never written;
 * in `auto` mode the prompt is skipped and the message is committed unattended.
 *
 * @param input - AI provider, git client, confirmation helper, and confirmation mode
 * @returns an object with `run(): Promise<CommitGeneratorResult>`
 * @throws CommitGenerationError when nothing is staged or the AI output is unusable
 */
export function createCommitGenerator(input: CommitGeneratorInput): {
  run(): Promise<CommitGeneratorResult>;
} {
  const validated = inputSchema.parse(input);
  const { ai, git, confirmation, mode } = validated;
  const shouldCreateCommit = validated.shouldCreateCommit ?? true;

  return {
    async run(): Promise<CommitGeneratorResult> {
      const diff = await git.getStagedDiff();
      if (!diff.trim()) {
        throw new CommitGenerationError(
          "No staged changes. Run git add first.",
        );
      }

      const recent = await git.getRecentCommits(RECENT_COMMIT_COUNT);
      const recentMessages = recent.map((c) => c.message);
      const stagedFiles = await git.getStagedFiles();
      const requiredScope = decideCommitScope(stagedFiles);

      while (true) {
        const prompt = buildPromptWithScope(
          diff,
          recentMessages,
          requiredScope,
        );
        const raw = await ai.complete(prompt, { temperature: 0.2 });
        const message = truncateHeaderToMaxLength(
          enforceScopePolicy(
            normalizeMessage(
              ensureConventionalPrefix(lowercaseType(cleanMessage(raw))),
            ),
            requiredScope,
          ),
        );
        if (mode === "dryrun") {
          await confirmation.ask({ mode, preview: message });
          return { status: "dryrun", message };
        }
        validateMessage(message);

        const result: ConfirmResult = await confirmation.ask({
          mode,
          preview: message,
          actions: ["yes", "no", "edit", "regenerate"],
        });

        if (result.action === "yes") {
          if (shouldCreateCommit) {
            await git.commit(message);
          } else {
            await git.setCommitMessage(message);
          }
          return { status: "committed", message };
        }

        if (result.action === "edit") {
          const edited = truncateHeaderToMaxLength(
            enforceScopePolicy(
              normalizeMessage(result.editedText.trim()),
              requiredScope,
            ),
          );
          if (!edited) {
            throw new CommitGenerationError(
              "Edited commit message is empty. Re-run the command and provide non-empty text in the editor.",
            );
          }
          if (shouldCreateCommit) {
            await git.commit(edited);
          } else {
            await git.setCommitMessage(edited);
          }
          return { status: "committed", message: edited };
        }

        if (result.action === "regenerate") {
          continue;
        }

        return { status: "cancelled" };
      }
    },
  };
}
