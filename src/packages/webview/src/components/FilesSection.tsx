import { memo, useCallback, useState, type MouseEvent } from "react";
import { c, mono, ui } from "../styles.js";
import type { RepoStatus } from "../types.js";

interface FilesSectionProps {
  files: RepoStatus["changedFiles"];
  activeFiles?: ReadonlyArray<string>;
  onOpenFileDiff: (path: string, staged: boolean, status: string) => void;
  onStageFile: (path: string) => void;
  onUnstageFile: (path: string) => void;
}

function statusGlyph(status: string): { sym: string; color: string } {
  if (status === "??" || /A/i.test(status)) return { sym: "A", color: c.green };
  if (/D/i.test(status)) return { sym: "D", color: c.red };
  if (/R/i.test(status)) return { sym: "R", color: c.info };
  return { sym: "M", color: c.yellow };
}

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 8 8"
      aria-hidden="true"
      style={{ transition: "transform 0.15s ease", transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
    >
      <path d="M1 2.5l3 3 3-3" stroke={c.textSubtle} strokeWidth="1.3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function GroupHeader({
  label,
  count,
  open,
  onToggle,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        padding: "5px 5px 2px",
        width: "100%",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        color: c.textSubtle,
      }}
    >
      <Caret open={open} />
      <span
        style={{
          fontSize: 9.5,
          fontWeight: 600,
          color: c.textSubtle,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          fontFamily: ui,
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 9, color: c.textSubtle, marginLeft: "auto", fontFamily: ui }}>
        {count}
      </span>
    </button>
  );
}

interface FileRowProps {
  path: string;
  status: string;
  isStaged: boolean;
  isActive: boolean;
  onOpenDiff: (path: string, staged: boolean, status: string) => void;
  onToggleStage: (path: string, isStaged: boolean) => void;
}

function splitPath(path: string): { name: string; dir: string } {
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (lastSlash === -1) return { name: path, dir: "" };
  return { name: path.slice(lastSlash + 1), dir: path.slice(0, lastSlash) };
}

const FileRow = memo(function FileRow({
  path,
  status,
  isStaged,
  isActive,
  onOpenDiff,
  onToggleStage,
}: FileRowProps) {
  const glyph = statusGlyph(status);
  const { name, dir } = splitPath(path);
  const handleCheckboxClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      onToggleStage(path, isStaged);
    },
    [path, isStaged, onToggleStage],
  );
  const handleOpen = useCallback((): void => {
    onOpenDiff(path, isStaged, status);
  }, [path, isStaged, status, onOpenDiff]);
  const baseBg = isActive
    ? "color-mix(in srgb, #007acc 20%, transparent)"
    : "transparent";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "3px 5px",
        borderRadius: 4,
        background: baseBg,
      }}
      onMouseEnter={(event) => {
        if (!isActive) {
          event.currentTarget.style.background =
            "var(--vscode-list-hoverBackground, color-mix(in srgb, var(--vscode-foreground) 6%, transparent))";
        }
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = baseBg;
      }}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={isStaged}
        aria-label={isStaged ? `Unstage ${path}` : `Stage ${path}`}
        onClick={handleCheckboxClick}
        style={{
          width: 14,
          height: 14,
          borderRadius: 3,
          border: `1px solid ${isStaged ? c.accent : c.border2}`,
          background: isStaged ? c.accent : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          padding: 0,
          cursor: "pointer",
        }}
      >
        {isStaged ? (
          <svg width="8" height="6" viewBox="0 0 8 6" aria-hidden="true">
            <path
              d="M1 3l2 2 4-4"
              stroke={c.accentText}
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </button>
      <button
        type="button"
        onClick={handleOpen}
        title={`Open diff: ${path}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          flex: 1,
          minWidth: 0,
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
          textAlign: "left",
          color: "inherit",
        }}
      >
        <span
          style={{
            fontFamily: mono,
            fontSize: 10,
            color: glyph.color,
            width: 10,
            flexShrink: 0,
            textAlign: "center",
          }}
        >
          {glyph.sym}
        </span>
        <span
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 6,
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          <span
            style={{
              fontFamily: ui,
              fontSize: 11.5,
              color: isActive ? c.text : c.textMuted,
              fontWeight: isActive ? 500 : 400,
              flexShrink: 0,
              maxWidth: "60%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {name}
          </span>
          {dir ? (
            <span
              style={{
                fontFamily: ui,
                fontSize: 10.5,
                color: c.textSubtle,
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                direction: "rtl",
                textAlign: "left",
              }}
            >
              {/* `direction: rtl` keeps the leading folder visible while
                  truncating in the middle, matching VS Code's SCM view. */}
              {"‎" + dir}
            </span>
          ) : null}
        </span>
        {isActive ? (
          <span
            style={{
              width: 4,
              height: 4,
              borderRadius: "50%",
              background: c.accent,
              flexShrink: 0,
              display: "inline-block",
            }}
          />
        ) : null}
      </button>
    </div>
  );
});

export function FilesSection({
  files,
  activeFiles = [],
  onOpenFileDiff,
  onStageFile,
  onUnstageFile,
}: FilesSectionProps) {
  const [stagedOpen, setStagedOpen] = useState<boolean>(true);
  const [changesOpen, setChangesOpen] = useState<boolean>(true);
  const staged = files.filter((f) => f.staged);
  const unstaged = files.filter((f) => f.unstaged);
  const activeSet = new Set(activeFiles);

  const handleToggleStage = useCallback(
    (path: string, isStaged: boolean): void => {
      if (isStaged) onUnstageFile(path);
      else onStageFile(path);
    },
    [onStageFile, onUnstageFile],
  );

  return (
    <div>
      <GroupHeader
        label="Staged"
        count={staged.length}
        open={stagedOpen}
        onToggle={() => setStagedOpen((v) => !v)}
      />
      {stagedOpen ? (
        staged.length === 0 ? (
          <div style={{ padding: "3px 5px", fontSize: 10.5, color: c.textSubtle, fontFamily: ui }}>
            No staged files.
          </div>
        ) : (
          staged.map((file) => (
            <FileRow
              key={`s:${file.path}`}
              path={file.path}
              status={file.status}
              isStaged
              isActive={activeSet.has(file.path)}
              onOpenDiff={onOpenFileDiff}
              onToggleStage={handleToggleStage}
            />
          ))
        )
      ) : null}
      <div style={{ height: 1, background: c.border, margin: "5px 0 2px" }} />
      <GroupHeader
        label="Changes"
        count={unstaged.length}
        open={changesOpen}
        onToggle={() => setChangesOpen((v) => !v)}
      />
      {changesOpen ? (
        unstaged.length === 0 ? (
          <div style={{ padding: "3px 5px", fontSize: 10.5, color: c.textSubtle, fontFamily: ui }}>
            No working tree changes.
          </div>
        ) : (
          unstaged.map((file) => (
            <FileRow
              key={`u:${file.path}`}
              path={file.path}
              status={file.status}
              isStaged={false}
              isActive={activeSet.has(file.path)}
              onOpenDiff={onOpenFileDiff}
              onToggleStage={handleToggleStage}
            />
          ))
        )
      ) : null}
    </div>
  );
}
