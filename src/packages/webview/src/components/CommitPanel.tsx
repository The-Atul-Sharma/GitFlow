import type { ChangeEvent } from "react";
import { btnStyle, c, layout, textareaStyle } from "../styles.js";
import { FilesSection } from "./FilesSection.js";
import type { RepoStatus } from "../types.js";

interface CommitPanelProps {
  changedFiles: RepoStatus["changedFiles"];
  draft: string;
  running: boolean;
  openedDiffs: ReadonlyArray<string>;
  onGenerate: () => void;
  onCommit: (message: string) => void;
  onDraftChange: (value: string) => void;
  onOpenFileDiff: (path: string, staged: boolean, status: string) => void;
  onStageFile: (path: string) => void;
  onUnstageFile: (path: string) => void;
}

export function CommitPanel({
  changedFiles,
  draft,
  running,
  openedDiffs,
  onGenerate,
  onCommit,
  onDraftChange,
  onOpenFileDiff,
  onStageFile,
  onUnstageFile,
}: CommitPanelProps) {
  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    onDraftChange(event.target.value);
  };
  const canCommit = draft.trim().length > 0 && !running;
  return (
    <>
      <button
        type="button"
        onClick={onGenerate}
        disabled={running}
        style={{ ...btnStyle("default", true) }}
      >
        <span style={{ fontSize: 11 }}>{running ? "◔" : "✦"}</span>
        {running ? "Generating…" : "Generate Commit Message"}
      </button>
      <textarea
        aria-label="Commit message"
        placeholder="Commit message…"
        value={draft}
        onChange={handleChange}
        rows={5}
        style={{ ...textareaStyle, minHeight: 90 }}
      />
      <button
        type="button"
        onClick={() => onCommit(draft)}
        disabled={!canCommit}
        style={{
          ...btnStyle("accent", true, !canCommit),
        }}
      >
        Commit
      </button>
      <div style={layout.divider} />
      <FilesSection
        files={changedFiles}
        activeFiles={openedDiffs}
        onOpenFileDiff={onOpenFileDiff}
        onStageFile={onStageFile}
        onUnstageFile={onUnstageFile}
      />
      {running ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "4px 0" }}>
          <Skeleton w="92%" />
          <Skeleton w="76%" />
          <Skeleton w="60%" />
        </div>
      ) : null}
    </>
  );
}

function Skeleton({ w }: { w: string }) {
  return (
    <div
      style={{
        width: w,
        height: 9,
        borderRadius: 4,
        background: "color-mix(in srgb, var(--vscode-foreground) 8%, transparent)",
        animation: "gp-pulse 1.4s ease-in-out infinite",
      }}
    />
  );
}

void c;
