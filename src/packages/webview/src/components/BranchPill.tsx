import { c, ui } from "../styles.js";

export type BranchState = "unpushed" | "pushed" | "open";

interface BranchPillProps {
  state: BranchState;
}

export function BranchPill({ state }: BranchPillProps) {
  const cfg = {
    unpushed: {
      label: "not pushed",
      bg: "color-mix(in srgb, var(--vscode-charts-orange, #ce9178) 14%, transparent)",
      color: c.orange,
    },
    pushed: {
      label: "pushed",
      bg: "color-mix(in srgb, var(--vscode-testing-iconPassed, #3fc88f) 12%, transparent)",
      color: c.green,
    },
    open: {
      label: "PR open",
      bg: "color-mix(in srgb, var(--vscode-charts-blue, #6cb8f0) 14%, transparent)",
      color: c.info,
    },
  }[state];
  return (
    <span
      style={{
        fontSize: 9,
        padding: "2px 6px",
        borderRadius: 10,
        background: cfg.bg,
        color: cfg.color,
        border: `1px solid color-mix(in srgb, ${cfg.color} 35%, transparent)`,
        fontFamily: ui,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {cfg.label}
    </span>
  );
}
