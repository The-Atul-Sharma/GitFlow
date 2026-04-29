import { btnStyle, c, layout, mono, severityPillStyle, ui } from "../styles.js";
import type { InlineIssue, RepoStatus } from "../types.js";
import { BranchPill } from "./BranchPill.js";

interface ReviewPanelProps {
  status: RepoStatus;
  issues: InlineIssue[];
  running: boolean;
  publishing: boolean;
  autoMode: boolean;
  onToggleAutoMode: () => void;
  onRun: () => void;
  onPublish: () => void;
  onOpenPr: () => void;
  onPreviewFix: (issueId: string) => void;
}

export function ReviewPanel({
  status,
  issues,
  running,
  publishing,
  autoMode,
  onToggleAutoMode,
  onRun,
  onPublish,
  onOpenPr,
  onPreviewFix,
}: ReviewPanelProps) {
  const branchLabel = status.branch ?? "(detached)";
  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11.5,
          color: c.textMuted,
          fontFamily: ui,
          minWidth: 0,
        }}
      >
        <span aria-hidden="true" style={{ flexShrink: 0 }}>⎇</span>
        <span
          style={{
            fontFamily: mono,
            color: c.accent,
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
          title={branchLabel}
        >
          {branchLabel}
        </span>
        {status.hasOpenPR ? <BranchPill state="open" /> : null}
        {status.hasOpenPR ? (
          <button
            type="button"
            onClick={onOpenPr}
            aria-label="Open PR in browser"
            title="Open PR in browser"
            style={{
              marginLeft: "auto",
              background: "transparent",
              border: "none",
              color: c.green,
              cursor: "pointer",
              fontSize: 13,
              padding: 0,
              flexShrink: 0,
            }}
          >
            ↗
          </button>
        ) : null}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 10px",
          background: "color-mix(in srgb, var(--vscode-button-background, #007acc) 8%, transparent)",
          border: `1px solid color-mix(in srgb, var(--vscode-button-background, #007acc) 22%, transparent)`,
          borderRadius: 5,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 11, color: c.text, fontFamily: ui, fontWeight: 500 }}>
            {autoMode ? "Auto mode" : "Manual mode"}
          </span>
          <span style={{ fontSize: 9.5, color: c.textMuted, fontFamily: ui }}>
            {autoMode ? "Publishes directly to remote" : "Preview comments before publishing"}
          </span>
        </div>
        <button
          type="button"
          aria-pressed={autoMode}
          onClick={onToggleAutoMode}
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: 0,
            border: "none",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          <span
            style={{
              width: 30,
              height: 17,
              borderRadius: 9,
              background: autoMode
                ? c.accent
                : "color-mix(in srgb, var(--vscode-foreground) 18%, transparent)",
              position: "relative",
              display: "inline-block",
            }}
          >
            <span
              style={{
                width: 13,
                height: 13,
                borderRadius: "50%",
                background: c.accentText,
                position: "absolute",
                top: 2,
                left: autoMode ? 15 : 2,
                boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
              }}
            />
          </span>
        </button>
      </div>

      <button
        type="button"
        onClick={onRun}
        disabled={running}
        style={{ ...btnStyle("default", true) }}
      >
        <span style={{ fontSize: 11 }}>✦</span>
        {running
          ? "Generating…"
          : autoMode
            ? "Generate & Publish Review"
            : "Generate Review"}
      </button>

      {issues.length > 0 ? (
        <>
          {!autoMode ? (
            <div
              style={{
                background: "color-mix(in srgb, var(--vscode-editorWarning-foreground, #d7ba7d) 8%, transparent)",
                border: `1px solid color-mix(in srgb, var(--vscode-editorWarning-foreground, #d7ba7d) 22%, transparent)`,
                borderRadius: 5,
                padding: "7px 10px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span style={{ fontSize: 11, color: c.yellow, fontFamily: ui }}>
                Preview · {issues.length} comment{issues.length === 1 ? "" : "s"} ready
              </span>
              <span style={{ fontSize: 10, color: c.textMuted, fontFamily: ui }}>
                edit before publishing
              </span>
            </div>
          ) : null}
          <div style={layout.divider} />
          {issues.map((issue) => (
            <div
              key={issue.id}
              style={{
                background: c.surface,
                border: `1px solid ${c.border}`,
                borderRadius: 5,
                padding: "8px 9px",
                display: "flex",
                flexDirection: "column",
                gap: 5,
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                <span style={severityPillStyle(issue.severity)}>{issue.severity}</span>
                <span
                  style={{
                    fontSize: 11.5,
                    color: c.text,
                    lineHeight: 1.4,
                    fontFamily: ui,
                    flex: 1,
                  }}
                >
                  {issue.comment}
                </span>
              </div>
              <div style={{ fontFamily: mono, fontSize: 10, color: c.textMuted }}>
                {issue.file}:{issue.line}
              </div>
              {!autoMode ? (
                <div style={{ display: "flex", gap: 5 }}>
                  <button
                    type="button"
                    onClick={() => onPreviewFix(issue.id)}
                    style={{
                      ...btnStyle("accent"),
                      height: 23,
                      fontSize: 10.5,
                      padding: "0 9px",
                    }}
                  >
                    Preview Fix
                  </button>
                </div>
              ) : null}
            </div>
          ))}
          {!autoMode ? (
            <button
              type="button"
              onClick={onPublish}
              disabled={publishing}
              style={{ ...btnStyle("accent", true), height: 30 }}
            >
              {publishing ? "Publishing…" : "Publish Review →"}
            </button>
          ) : null}
        </>
      ) : null}
    </>
  );
}
