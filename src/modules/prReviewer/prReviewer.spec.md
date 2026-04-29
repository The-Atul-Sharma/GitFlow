# Module: prReviewer

## Purpose

Read the diff of a pull request and use AI to identify issues at
specific file/line locations. Optionally post the issues as inline
review comments on the platform.

## Dependencies

- core/ai — AI for analysing the diff and producing issues
- core/git — getDiffAgainst for local review
- core/confirmation — interactive confirm before posting
- platforms (interface) — getPRDiff, postInlineComment

## Public API

```ts
export interface InlineIssue {
  file: string;
  line: number;
  severity: "blocker" | "warning" | "info";
  comment: string;
  suggestedFix?: string;
}

// Adds to the GitPlatform interface from prCreator
export interface GitPlatform {
  // ...existing methods
  getPRDiff(prId: string): Promise<string>;
  postInlineComment(prId: string, issue: InlineIssue): Promise<void>;
}

export interface ReviewRule {
  id: string;
  description: string;
  severity: "blocker" | "warning" | "info";
}

export interface PrReviewerInput {
  ai: AIProvider;
  git: GitClient;
  platform: GitPlatform;
  confirmation: Confirmation;
  mode: ConfirmMode;
  rules: ReviewRule[]; // configured review rules from gpilot.config.yml
  prId?: string; // if provided, fetch diff from platform; otherwise local
}

export interface PrReviewerResult {
  status: "posted" | "reviewed" | "cancelled" | "dryrun";
  issues: InlineIssue[];
}

export function createPrReviewer(input: PrReviewerInput): {
  run(): Promise<PrReviewerResult>;
};
```

## Default review rules

If rules array is empty, use these defaults:

- no-console-logs — flag console.log left in production code
- no-hardcoded-secrets — flag API keys, tokens, or passwords in code (blocker)
- no-any-in-typescript — flag `: any` type annotations (warning)
- tests-required — flag new exported functions without test files (info)
- no-todo-comments — flag TODO and FIXME comments (info)

## Flow

1. Get the diff:
   - If prId provided → call platform.getPRDiff(prId)
   - Otherwise → call git.getDiffAgainst(defaultBranch)
2. If diff is empty, return reviewed with empty issues array
3. Build prompt for AI with diff and review rules
4. Get JSON array of issues from AI
5. Validate structure of each issue (file, line, severity, comment required)
6. If 0 issues found, return reviewed with empty issues
7. Show summary preview via confirmation:
   "{N} issues found ({blockers} blockers, {warnings} warnings, {infos} infos)"
8. If prId is provided, ask whether to post to PR:
   - yes → post each issue via platform.postInlineComment, return posted
   - select → let user toggle which issues to post (interactive only)
   - no → return reviewed (issues returned but not posted)
   - dryrun → print issues, return dryrun
9. If no prId, just return reviewed with the issues array

## Prompt for AI
