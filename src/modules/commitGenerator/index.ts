import { z } from 'zod';
import type { AIProvider } from '../../core/ai/index.ts';
import type { GitClient } from '../../core/git/index.ts';
import type {
  Confirmation,
  ConfirmMode,
  ConfirmResult,
} from '../../core/confirmation/index.ts';

export interface CommitGeneratorInput {
  ai: AIProvider;
  git: GitClient;
  confirmation: Confirmation;
  mode: ConfirmMode;
}

export interface CommitGeneratorResult {
  status: 'committed' | 'cancelled' | 'dryrun';
  message?: string;
}

export class CommitGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommitGenerationError';
  }
}

const RECENT_COMMIT_COUNT = 5;
const HEADER_MAX_LENGTH = 100;

const CONVENTIONAL_TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
] as const;

const HEADER_PATTERN = new RegExp(
  `^(${CONVENTIONAL_TYPES.join('|')})(\\([^)]+\\))?!?: \\S.*`,
);

const inputSchema = z.object({
  ai: z.custom<AIProvider>(
    (v) =>
      v !== null &&
      typeof v === 'object' &&
      typeof (v as AIProvider).complete === 'function',
    'ai must be an AIProvider. Build one with createAIProvider() from core/ai.',
  ),
  git: z.custom<GitClient>(
    (v) =>
      v !== null &&
      typeof v === 'object' &&
      typeof (v as GitClient).getStagedDiff === 'function',
    'git must be a GitClient. Build one with createGitClient() from core/git.',
  ),
  confirmation: z.custom<Confirmation>(
    (v) =>
      v !== null &&
      typeof v === 'object' &&
      typeof (v as Confirmation).ask === 'function',
    'confirmation must be a Confirmation. Build one with createConfirmation() from core/confirmation.',
  ),
  mode: z.enum(['interactive', 'auto', 'dryrun'], {
    message:
      'mode must be one of "interactive", "auto", or "dryrun". Pass mode from the CLI flag (--auto / --dry-run).',
  }),
});

function buildPrompt(diff: string, recentMessages: string[]): string {
  const recentBlock = recentMessages.length
    ? `Recent commit messages on this branch (match their tone and style):\n${recentMessages
        .map((m) => `- ${m}`)
        .join('\n')}\n\n`
    : '';
  return (
    `You are a senior engineer writing a Conventional Commit message.\n\n` +
    `Rules:\n` +
    `- First line: <type>(<scope>)?: <subject>\n` +
    `- Allowed types: ${CONVENTIONAL_TYPES.join(', ')}\n` +
    `- Subject: imperative mood, lowercase, no trailing period, <= 72 chars\n` +
    `- Optional body: blank line after header, wrap at 72 chars, explain *why*\n` +
    `- No code fences, no surrounding quotes, no preface\n\n` +
    recentBlock +
    `Staged diff:\n${diff}\n\n` +
    `Return ONLY the commit message.`
  );
}

function cleanMessage(raw: string): string {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  }
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

function validateMessage(message: string): void {
  if (!message) {
    throw new CommitGenerationError(
      'AI returned an empty commit message. Choose regenerate, or switch providers/models in gitflow.config.yml.',
    );
  }
  const header = message.split('\n', 1)[0] ?? '';
  if (!header.trim()) {
    throw new CommitGenerationError(
      'AI returned a commit message with no header line. Choose regenerate, or use edit to write one.',
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

  return {
    async run(): Promise<CommitGeneratorResult> {
      const diff = await git.getStagedDiff();
      if (!diff.trim()) {
        throw new CommitGenerationError(
          'No staged changes. Run git add first.',
        );
      }

      const recent = await git.getRecentCommits(RECENT_COMMIT_COUNT);
      const recentMessages = recent.map((c) => c.message);

      while (true) {
        const prompt = buildPrompt(diff, recentMessages);
        const raw = await ai.complete(prompt, { temperature: 0.2 });
        const message = cleanMessage(raw);
        validateMessage(message);

        if (mode === 'dryrun') {
          await confirmation.ask({ mode, preview: message });
          return { status: 'dryrun', message };
        }

        const result: ConfirmResult = await confirmation.ask({
          mode,
          preview: message,
          actions: ['yes', 'no', 'edit', 'regenerate'],
        });

        if (result.action === 'yes') {
          await git.setCommitMessage(message);
          return { status: 'committed', message };
        }

        if (result.action === 'edit') {
          const edited = result.editedText.trim();
          if (!edited) {
            throw new CommitGenerationError(
              'Edited commit message is empty. Re-run the command and provide non-empty text in the editor.',
            );
          }
          await git.setCommitMessage(edited);
          return { status: 'committed', message: edited };
        }

        if (result.action === 'regenerate') {
          continue;
        }

        return { status: 'cancelled' };
      }
    },
  };
}
