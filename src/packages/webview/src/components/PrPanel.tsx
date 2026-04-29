import type { ChangeEvent } from "react";
import { btnStyle, c, inputStyle, mono, textareaStyle, ui } from "../styles.js";
import type { RepoStatus } from "../types.js";
import { BranchPill, type BranchState } from "./BranchPill.js";

interface PrPanelProps {
  status: RepoStatus;
  draft: { title: string; description: string };
  running: boolean;
  pushing: boolean;
  onGenerate: () => void;
  onCreate: (title: string, description: string) => void;
  onPush: () => void;
  onDraftChange: (draft: { title: string; description: string }) => void;
}

export function PrPanel({
  status,
  draft,
  running,
  pushing,
  onGenerate,
  onCreate,
  onPush,
  onDraftChange,
}: PrPanelProps) {
  const branchLabel = status.branch ?? "(detached)";
  const branchState: BranchState = status.hasOpenPR
    ? "open"
    : status.isBranchPushed
      ? "pushed"
      : "unpushed";
  const handleTitleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onDraftChange({ ...draft, title: event.target.value });
  };
  const handleDescriptionChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    onDraftChange({ ...draft, description: event.target.value });
  };
  const canCreate = !running && draft.title.trim().length > 0 && status.isBranchPushed;
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: c.textMuted, fontFamily: ui }}>
        <span aria-hidden="true">⎇</span>
        <span style={{ fontFamily: mono, color: c.accent, fontWeight: 500 }}>{branchLabel}</span>
        <BranchPill state={branchState} />
      </div>
      {!status.isBranchPushed ? (
        <>
          <div style={{ fontSize: 11.5, color: c.textMuted, lineHeight: 1.6, fontFamily: ui }}>
            Push this branch to your remote first before creating a PR.
          </div>
          <button
            type="button"
            onClick={onPush}
            disabled={pushing}
            style={{ ...btnStyle("default", true) }}
          >
            ↑ {pushing ? "Pushing…" : "Push Branch"}
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={onGenerate}
            disabled={running}
            style={{ ...btnStyle("default", true) }}
          >
            <span style={{ fontSize: 11 }}>✦</span>
            {running ? "Generating…" : "Generate PR Title + Description"}
          </button>
          <input
            type="text"
            aria-label="PR title"
            placeholder="PR title"
            value={draft.title}
            onChange={handleTitleChange}
            style={inputStyle}
          />
          <textarea
            aria-label="PR description"
            placeholder="PR description (markdown)"
            value={draft.description}
            onChange={handleDescriptionChange}
            rows={7}
            style={{ ...textareaStyle, minHeight: 130 }}
          />
          <button
            type="button"
            onClick={() => onCreate(draft.title, draft.description)}
            disabled={!canCreate}
            style={{ ...btnStyle("accent", true, !canCreate) }}
          >
            Create PR
          </button>
        </>
      )}
    </>
  );
}
