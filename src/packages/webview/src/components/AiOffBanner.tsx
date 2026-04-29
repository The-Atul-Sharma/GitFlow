import { c, ui } from "../styles.js";

export function AiOffBanner() {
  return (
    <div style={{ padding: "10px 12px", flexShrink: 0 }}>
      <div
        style={{
          background: "color-mix(in srgb, var(--vscode-foreground) 6%, transparent)",
          border: `1px solid ${c.border2}`,
          borderRadius: 6,
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          gap: 9,
        }}
      >
        <span style={{ fontSize: 16 }} aria-hidden="true">
          🔒
        </span>
        <span style={{ fontSize: 11.5, color: c.textMuted, fontFamily: ui, lineHeight: 1.5 }}>
          Enable <span style={{ color: c.text, fontWeight: 500 }}>AI Mode</span> to use GitPilot
          features.
        </span>
      </div>
    </div>
  );
}
