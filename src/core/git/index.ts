import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';

const execFileAsync = promisify(execFile);

const COMMIT_FIELD_SEP = '\x1f';
const MAX_BUFFER = 50 * 1024 * 1024;

export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: Date;
}

export interface GitClient {
  getStagedDiff(): Promise<string>;
  getDiffAgainst(baseBranch: string): Promise<string>;
  getRecentCommits(count: number): Promise<CommitInfo[]>;
  setCommitMessage(message: string): Promise<void>;
  commit(message: string): Promise<void>;
  getCurrentBranch(): Promise<string>;
  getDefaultBranch(): Promise<string>;
  getStagedFiles(): Promise<string[]>;
  getChangedFiles(baseBranch: string): Promise<string[]>;
  getRemoteUrl(): Promise<string>;
  isInsideRepo(): Promise<boolean>;
}

export class GitError extends Error {
  readonly command: string;
  readonly stderr: string;

  constructor(command: string, stderr: string) {
    super(`${command} failed: ${stderr}`);
    this.name = 'GitError';
    this.command = command;
    this.stderr = stderr;
  }
}

export class NotInRepoError extends Error {
  constructor() {
    super('Not inside a git repository. Run git init first.');
    this.name = 'NotInRepoError';
  }
}

const cwdSchema = z
  .string()
  .min(1, 'cwd is empty. Pass an absolute directory path or omit to use process.cwd().')
  .optional();

const branchSchema = z
  .string()
  .min(
    1,
    'baseBranch is empty. Pass a branch name like "main" or "master".',
  );

const messageSchema = z
  .string()
  .min(
    1,
    'commit message is empty. Pass a non-empty string describing the change.',
  );

const countSchema = z
  .number()
  .int('count must be an integer. Pass e.g. 10.')
  .positive('count must be > 0. Pass a positive integer such as 10.');

interface ExecFailure extends Error {
  stderr?: string | Buffer;
  stdout?: string | Buffer;
  code?: number | string;
}

function readStderr(err: ExecFailure): string {
  if (typeof err.stderr === 'string') return err.stderr;
  if (err.stderr instanceof Buffer) return err.stderr.toString('utf8');
  return err.message;
}

async function runGit(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: MAX_BUFFER,
    });
    return stdout.trimEnd();
  } catch (err) {
    const failure = err as ExecFailure;
    const stderr = readStderr(failure).trim();
    if (/not a git repository/i.test(stderr)) {
      throw new NotInRepoError();
    }
    throw new GitError(`git ${args.join(' ')}`, stderr);
  }
}

function parseCommitLine(line: string): CommitInfo {
  const [hash, message, author, date] = line.split(COMMIT_FIELD_SEP);
  if (!hash || message === undefined || !author || !date) {
    throw new GitError(
      'git log',
      `unexpected commit format: "${line}". Verify git is installed and not aliased.`,
    );
  }
  return {
    hash,
    message,
    author,
    date: new Date(date),
  };
}

function splitLines(stdout: string): string[] {
  if (!stdout) return [];
  return stdout.split('\n').filter((line) => line.length > 0);
}

/**
 * Construct a GitClient bound to a working directory.
 *
 * All methods invoke `git` via `child_process.execFile` (no shell interpolation,
 * so arguments are safe from shell injection). Output is trimmed of trailing
 * whitespace before being returned. Diff output is returned as raw text.
 *
 * @param cwd - directory in which to run git; defaults to process.cwd()
 * @returns a GitClient implementation bound to `cwd`
 */
export function createGitClient(cwd?: string): GitClient {
  cwdSchema.parse(cwd);
  const workDir = cwd ?? process.cwd();

  return {
    /**
     * Return the staged diff (`git diff --cached`) as raw text.
     * Returns an empty string when nothing is staged — callers decide what to do.
     */
    async getStagedDiff(): Promise<string> {
      return runGit(['diff', '--cached'], workDir);
    },

    /**
     * Return the diff between HEAD and the merge-base with `baseBranch`,
     * matching the typical "PR diff" view (`git diff <baseBranch>...HEAD`).
     *
     * @param baseBranch - branch to diff against, e.g. "main"
     */
    async getDiffAgainst(baseBranch: string): Promise<string> {
      const branch = branchSchema.parse(baseBranch);
      return runGit(['diff', `${branch}...HEAD`], workDir);
    },

    /**
     * Return up to `count` most recent commits on the current branch, newest first.
     *
     * @param count - maximum number of commits to return; must be a positive integer
     */
    async getRecentCommits(count: number): Promise<CommitInfo[]> {
      const limit = countSchema.parse(count);
      const format = ['%H', '%s', '%an', '%aI'].join(COMMIT_FIELD_SEP);
      const stdout = await runGit(
        ['log', `-n${limit}`, `--pretty=format:${format}`],
        workDir,
      );
      return splitLines(stdout).map(parseCommitLine);
    },

    /**
     * Write `message` to `.git/COMMIT_EDITMSG` so a `prepare-commit-msg` hook
     * (or the next `git commit`) picks it up. Does not create a commit.
     *
     * @param message - the commit message body to stage in COMMIT_EDITMSG
     */
    async setCommitMessage(message: string): Promise<void> {
      const text = messageSchema.parse(message);
      const gitDir = await runGit(['rev-parse', '--git-dir'], workDir);
      const gitDirPath = isAbsolute(gitDir) ? gitDir : join(workDir, gitDir);
      await writeFile(join(gitDirPath, 'COMMIT_EDITMSG'), text, 'utf8');
    },

    /**
     * Create a commit with the given message. Fails if nothing is staged.
     *
     * @param message - the commit message; must be non-empty
     */
    async commit(message: string): Promise<void> {
      const text = messageSchema.parse(message);
      await runGit(['commit', '-m', text], workDir);
    },

    /** Return the current branch name (empty string in detached-HEAD state). */
    async getCurrentBranch(): Promise<string> {
      return runGit(['branch', '--show-current'], workDir);
    },

    /**
     * Return the repository's default branch — `main` if it exists,
     * otherwise `master`. Does not consult the remote HEAD.
     */
    async getDefaultBranch(): Promise<string> {
      try {
        await runGit(
          ['show-ref', '--verify', '--quiet', 'refs/heads/main'],
          workDir,
        );
        return 'main';
      } catch (err) {
        if (err instanceof NotInRepoError) throw err;
        return 'master';
      }
    },

    /** Return staged file paths relative to the repo root. */
    async getStagedFiles(): Promise<string[]> {
      const stdout = await runGit(['diff', '--cached', '--name-only'], workDir);
      return splitLines(stdout);
    },

    /**
     * Return file paths changed between HEAD and the merge-base with `baseBranch`.
     *
     * @param baseBranch - branch to diff against, e.g. "main"
     */
    async getChangedFiles(baseBranch: string): Promise<string[]> {
      const branch = branchSchema.parse(baseBranch);
      const stdout = await runGit(
        ['diff', '--name-only', `${branch}...HEAD`],
        workDir,
      );
      return splitLines(stdout);
    },

    /** Return the URL of the `origin` remote. */
    async getRemoteUrl(): Promise<string> {
      return runGit(['config', '--get', 'remote.origin.url'], workDir);
    },

    /**
     * Return whether `cwd` is inside a git working tree.
     * Never throws — returns false when git is unavailable or the path is not a repo.
     */
    async isInsideRepo(): Promise<boolean> {
      try {
        const { stdout } = await execFileAsync(
          'git',
          ['rev-parse', '--is-inside-work-tree'],
          { cwd: workDir, maxBuffer: MAX_BUFFER },
        );
        return stdout.trim() === 'true';
      } catch {
        return false;
      }
    },
  };
}
