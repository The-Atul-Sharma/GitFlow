import { z } from "zod";

export const inlineIssueSchema = z.object({
  id: z.string().min(1),
  file: z.string().min(1),
  line: z.number().int().nonnegative(),
  severity: z.enum(["blocker", "warning", "info"]),
  comment: z.string().min(1),
  suggestedFix: z.string().optional(),
});

export const modelEntrySchema = z.object({
  label: z.string().min(1, "ModelEntry.label must be non-empty."),
  provider: z.string().min(1, "ModelEntry.provider must be non-empty."),
  model: z.string().min(1, "ModelEntry.model must be non-empty."),
});

export const repoStatusSchema = z.object({
  branch: z.string().nullable(),
  hasCommit: z.boolean(),
  isBranchPushed: z.boolean(),
  hasOpenPR: z.boolean(),
  changedFiles: z.array(
    z.object({
      status: z.string().min(1),
      path: z.string().min(1),
      staged: z.boolean().default(false),
      unstaged: z.boolean().default(false),
    }),
  ),
});

export const gpilotModeSchema = z.enum(["gpilot", "native"]);

export type InlineIssue = z.infer<typeof inlineIssueSchema>;
export type ModelEntry = z.infer<typeof modelEntrySchema>;
export type RepoStatus = z.infer<typeof repoStatusSchema>;
export type gpilotMode = z.infer<typeof gpilotModeSchema>;

export const extensionMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("configUpdate"),
    provider: z.string().min(1),
    model: z.string().min(1),
  }),
  z.object({
    type: z.literal("modelOptionsUpdate"),
    models: z.array(modelEntrySchema),
  }),
  z.object({
    type: z.literal("commandRunning"),
    command: z.string().min(1),
  }),
  z.object({
    type: z.literal("commandDone"),
    command: z.string().min(1),
  }),
  z.object({
    type: z.literal("commandFailed"),
    command: z.string().min(1),
    error: z.string().min(1),
  }),
  z.object({
    type: z.literal("setupStatus"),
    aiConfigured: z.boolean(),
    platformConfigured: z.boolean(),
    ready: z.boolean(),
  }),
  z.object({
    type: z.literal("commitDraft"),
    message: z.string(),
  }),
  z.object({
    type: z.literal("prDraft"),
    title: z.string(),
    description: z.string(),
  }),
  z.object({
    type: z.literal("reviewResult"),
    issues: z.array(inlineIssueSchema),
  }),
  z.object({
    type: z.literal("repoStatus"),
    status: repoStatusSchema,
  }),
  z.object({
    type: z.literal("modeUpdate"),
    mode: gpilotModeSchema,
  }),
  z.object({
    type: z.literal("specFilePicked"),
    path: z.string().min(1),
  }),
  z.object({
    type: z.literal("specGenerated"),
    path: z.string().min(1),
    preview: z.string(),
  }),
  z.object({
    type: z.literal("openDiffsUpdate"),
    paths: z.array(z.string().min(1)),
  }),
]);

export type ExtensionMessage = z.infer<typeof extensionMessageSchema>;

export const webviewMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("switchModel"),
    provider: z.string().min(1),
    model: z.string().min(1),
  }),
  z.object({ type: z.literal("setupKeys") }),
  z.object({ type: z.literal("requestState") }),
  z.object({ type: z.literal("refreshStatus") }),
  z.object({ type: z.literal("generateCommit") }),
  z.object({
    type: z.literal("commitMessage"),
    message: z.string().min(1),
  }),
  z.object({ type: z.literal("generatePr") }),
  z.object({
    type: z.literal("createPr"),
    title: z.string().min(1),
    description: z.string().min(1),
  }),
  z.object({ type: z.literal("pushBranch") }),
  z.object({ type: z.literal("runReview") }),
  z.object({ type: z.literal("publishReview") }),
  z.object({ type: z.literal("openPr") }),
  z.object({
    type: z.literal("previewFix"),
    issueId: z.string().min(1),
  }),
  z.object({
    type: z.literal("applyFix"),
    issueId: z.string().min(1),
  }),
  z.object({ type: z.literal("openWorkingTree") }),
  z.object({
    type: z.literal("openFileDiff"),
    path: z.string().min(1),
    staged: z.boolean().default(false),
    status: z.string().default(""),
  }),
  z.object({
    type: z.literal("closeFileDiff"),
    path: z.string().min(1),
  }),
  z.object({
    type: z.literal("stageFile"),
    path: z.string().min(1),
  }),
  z.object({
    type: z.literal("unstageFile"),
    path: z.string().min(1),
  }),
  z.object({
    type: z.literal("setMode"),
    mode: gpilotModeSchema,
  }),
  z.object({ type: z.literal("pickSpecFile") }),
  z.object({
    type: z.literal("generateSpec"),
    path: z.string().min(1),
    sections: z.array(z.string().min(1)),
  }),
  z.object({
    type: z.literal("openSpec"),
    path: z.string().min(1),
  }),
]);

export type WebviewMessage = z.infer<typeof webviewMessageSchema>;
