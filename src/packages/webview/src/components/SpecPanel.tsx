import { useState } from "react";
import { btnStyle, c, inputStyle, mono, ui } from "../styles.js";

interface SpecPanelProps {
  pickedFile: string | null;
  generatedPath: string | null;
  generatedPreview: string;
  running: boolean;
  onPickFile: () => void;
  onGenerate: (path: string, sections: string[]) => void;
  onOpen: (path: string) => void;
}

const SECTIONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "purpose", label: "Purpose & overview" },
  { key: "api", label: "Exported API surface" },
  { key: "usage", label: "Usage examples" },
  { key: "edges", label: "Edge cases & error handling" },
];

function specPath(file: string): string {
  const lastDot = file.lastIndexOf(".");
  const base = lastDot > -1 ? file.slice(0, lastDot) : file;
  return `${base}.spec.md`;
}

export function SpecPanel({
  pickedFile,
  generatedPath,
  generatedPreview,
  running,
  onPickFile,
  onGenerate,
  onOpen,
}: SpecPanelProps) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(SECTIONS.map((s) => s.key)),
  );
  const toggle = (key: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const handleGenerate = (): void => {
    if (!pickedFile) return;
    onGenerate(pickedFile, Array.from(selected));
  };
  const outputPath = pickedFile ? specPath(pickedFile) : "—";
  return (
    <>
      <button
        type="button"
        onClick={onPickFile}
        title={pickedFile ?? "Pick a file from the repo"}
        style={{
          ...inputStyle,
          textAlign: "left",
          cursor: "pointer",
          color: pickedFile ? c.text : c.textMuted,
          fontFamily: mono,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          display: "block",
        }}
        aria-label="Pick a file from the repo"
      >
        {pickedFile ?? "🔍 Pick a file from the repo…"}
      </button>

      <div
        style={{
          background: c.surface,
          border: `1px solid color-mix(in srgb, var(--vscode-button-background, #007acc) 22%, transparent)`,
          borderRadius: 5,
          padding: "9px 10px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 14 }} aria-hidden="true">📄</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11.5, color: c.text, fontFamily: ui, fontWeight: 500 }}>
            Output
          </div>
          <div
            style={{
              fontSize: 10,
              color: c.textMuted,
              fontFamily: mono,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {outputPath}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div
          style={{
            fontSize: 9.5,
            fontWeight: 600,
            color: c.textSubtle,
            letterSpacing: "0.07em",
            textTransform: "uppercase",
            fontFamily: ui,
          }}
        >
          Include in spec
        </div>
        {SECTIONS.map((opt) => {
          const checked = selected.has(opt.key);
          return (
            <label
              key={opt.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                cursor: "pointer",
                fontSize: 11.5,
                color: c.textMuted,
                fontFamily: ui,
              }}
            >
              <span
                style={{
                  width: 13,
                  height: 13,
                  borderRadius: 3,
                  border: `1px solid ${checked ? c.accent : c.border2}`,
                  background: checked ? c.accent : "transparent",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {checked ? (
                  <svg width="8" height="6" viewBox="0 0 8 6">
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
              </span>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(opt.key)}
                style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
              />
              {opt.label}
            </label>
          );
        })}
      </div>

      <button
        type="button"
        onClick={handleGenerate}
        disabled={!pickedFile || running || selected.size === 0}
        style={{
          ...btnStyle("accent", true, !pickedFile || running || selected.size === 0),
          height: 30,
        }}
      >
        <span style={{ fontSize: 11 }}>✦</span>
        {running ? "Generating…" : "Generate spec.md"}
      </button>

      {generatedPath ? (
        <div
          style={{
            background: c.surface,
            border: `1px solid color-mix(in srgb, var(--vscode-testing-iconPassed, #3fc88f) 22%, transparent)`,
            borderRadius: 6,
            padding: "10px 10px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  background: "color-mix(in srgb, var(--vscode-testing-iconPassed, #3fc88f) 12%, transparent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14,
                  flexShrink: 0,
                }}
              >
                ✓
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11.5, color: c.text, fontFamily: ui, fontWeight: 500 }}>
                  spec.md generated
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: c.textMuted,
                    fontFamily: mono,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={generatedPath}
                >
                  {generatedPath}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onOpen(generatedPath)}
              style={{ ...btnStyle("subtle"), height: 22, fontSize: 10.5, padding: "0 8px" }}
            >
              Open ↗
            </button>
          </div>
          {generatedPreview ? (
            <pre
              style={{
                margin: 0,
                background: "color-mix(in srgb, var(--vscode-foreground) 5%, transparent)",
                borderRadius: 4,
                padding: "8px 9px",
                fontFamily: mono,
                fontSize: 10,
                color: c.textMuted,
                lineHeight: 1.75,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {generatedPreview}
            </pre>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
