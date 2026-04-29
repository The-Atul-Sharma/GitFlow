import type { CSSProperties } from "react";
import type { InlineIssue } from "./types.js";

/**
 * Theme tokens are sourced from VS Code's CSS variables so the panel matches
 * whatever theme the user has applied. The `c.*` aliases expose convenient
 * names that mirror the design file (bg/surface/border/text/etc.) but resolve
 * to theme-aware values at render time.
 */
export const c = {
  bg: "transparent",
  surface: "color-mix(in srgb, var(--vscode-foreground) 5%, transparent)",
  surface2: "color-mix(in srgb, var(--vscode-foreground) 8%, transparent)",
  inputBg: "var(--vscode-input-background, color-mix(in srgb, var(--vscode-foreground) 6%, transparent))",
  border: "color-mix(in srgb, var(--vscode-foreground) 12%, transparent)",
  border2: "color-mix(in srgb, var(--vscode-foreground) 22%, transparent)",
  text: "var(--vscode-foreground)",
  textMuted: "var(--vscode-descriptionForeground, color-mix(in srgb, var(--vscode-foreground) 65%, transparent))",
  textSubtle: "color-mix(in srgb, var(--vscode-foreground) 40%, transparent)",
  accent: "#007acc",
  accentHover: "#0a84d6",
  accentText: "#ffffff",
  green: "var(--vscode-testing-iconPassed, var(--vscode-charts-green, #3fc88f))",
  yellow: "var(--vscode-editorWarning-foreground, var(--vscode-charts-yellow, #d7ba7d))",
  orange: "var(--vscode-charts-orange, #ce9178)",
  red: "var(--vscode-errorForeground, var(--vscode-charts-red, #f48771))",
  info: "var(--vscode-charts-blue, #6cb8f0)",
} as const;

export const ui = "var(--vscode-font-family, 'Segoe WPC', 'Segoe UI', sans-serif)";
export const mono = "var(--vscode-editor-font-family, 'SF Mono', Menlo, Consolas, monospace)";

export const sev = {
  blocker: { bg: "color-mix(in srgb, var(--vscode-errorForeground, #f47171) 14%, transparent)", color: c.red },
  warning: { bg: "color-mix(in srgb, var(--vscode-editorWarning-foreground, #d7ba7d) 14%, transparent)", color: c.yellow },
  info: { bg: "color-mix(in srgb, var(--vscode-charts-blue, #6cb8f0) 18%, transparent)", color: c.info },
} as const;

export const ACCENT_BLUE = "#007acc" as const;

const baseBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 5,
  padding: "0 12px",
  height: 28,
  borderRadius: 5,
  fontSize: 11.5,
  fontWeight: 500,
  fontFamily: ui,
  whiteSpace: "nowrap",
  flexShrink: 0,
  cursor: "pointer",
  border: "1px solid transparent",
  background: c.surface2,
  color: c.text,
  boxSizing: "border-box",
};

export const layout: Record<string, CSSProperties> = {
  page: {
    background: c.bg,
    margin: 0,
    padding: 0,
    minHeight: "100vh",
    boxSizing: "border-box",
  },
  shell: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    width: "100%",
    background: c.bg,
    color: c.text,
    fontFamily: ui,
    fontSize: 12,
    boxSizing: "border-box",
    overflow: "hidden",
  },
  content: {
    flex: 1,
    overflowY: "auto",
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  divider: {
    height: 1,
    background: c.border,
    margin: "2px 0",
  },
  card: {
    background: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: 6,
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  monospace: {
    fontFamily: mono,
    fontSize: 11,
  },
};

export function btnStyle(
  variant: "default" | "accent" | "ghost" | "subtle" | "green" = "default",
  full = false,
  locked = false,
): CSSProperties {
  const v: CSSProperties = { ...baseBtn };
  if (variant === "accent") {
    v.background = c.accent;
    v.color = c.accentText;
    v.borderColor = "transparent";
  } else if (variant === "ghost") {
    v.background = "transparent";
    v.color = c.textMuted;
    v.borderColor = "transparent";
  } else if (variant === "subtle") {
    v.background = "color-mix(in srgb, var(--vscode-foreground) 4%, transparent)";
    v.color = c.textMuted;
    v.borderColor = c.border;
  } else if (variant === "green") {
    v.background = "color-mix(in srgb, var(--vscode-testing-iconPassed, #3fc88f) 12%, transparent)";
    v.color = c.green;
    v.borderColor = "color-mix(in srgb, var(--vscode-testing-iconPassed, #3fc88f) 25%, transparent)";
  } else {
    v.borderColor = c.border2;
  }
  if (full) v.width = "100%";
  if (locked) {
    v.background = "color-mix(in srgb, var(--vscode-foreground) 4%, transparent)";
    v.color = c.textSubtle;
    v.borderColor = c.border;
    v.cursor = "not-allowed";
  }
  return v;
}

export const inputStyle: CSSProperties = {
  background: c.inputBg,
  color: "var(--vscode-input-foreground, var(--vscode-foreground))",
  border: `1px solid ${c.border2}`,
  borderRadius: 5,
  padding: "6px 9px",
  fontSize: 11.5,
  fontFamily: ui,
  width: "100%",
  boxSizing: "border-box",
};

export const textareaStyle: CSSProperties = {
  ...inputStyle,
  fontFamily: mono,
  lineHeight: 1.6,
  resize: "vertical",
  minHeight: 80,
};

export function severityPillStyle(severity: InlineIssue["severity"]): CSSProperties {
  const cfg = sev[severity];
  return {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: "0.06em",
    padding: "2px 5px",
    borderRadius: 3,
    background: cfg.bg,
    color: cfg.color,
    fontFamily: ui,
    flexShrink: 0,
    textTransform: "uppercase",
    display: "inline-block",
  };
}
