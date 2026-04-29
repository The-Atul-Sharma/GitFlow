import type { ChangeEvent } from "react";
import { c, ui } from "../styles.js";
import type { ModelEntry } from "../types.js";

interface HeaderProps {
  status: "ready" | "running" | "error" | "setup";
  aiOn: boolean;
  onToggleAi: () => void;
  currentProvider: string;
  currentModel: string;
  models: ReadonlyArray<ModelEntry>;
  onModelChange: (provider: string, model: string) => void;
}

const statusColors: Record<HeaderProps["status"], string> = {
  ready: c.green,
  running: c.accent,
  error: c.red,
  setup: c.red,
};
const statusLabels: Record<HeaderProps["status"], string> = {
  ready: "Ready",
  running: "Running…",
  error: "Error",
  setup: "Setup required",
};

export function Header({
  status,
  aiOn,
  onToggleAi,
  currentProvider,
  currentModel,
  models,
  onModelChange,
}: HeaderProps) {
  const value = JSON.stringify({ provider: currentProvider, model: currentModel });
  const handleChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    try {
      const parsed = JSON.parse(event.target.value) as { provider?: unknown; model?: unknown };
      if (typeof parsed.provider === "string" && typeof parsed.model === "string") {
        onModelChange(parsed.provider, parsed.model);
      }
    } catch {
      /* ignore */
    }
  };
  return (
    <div
      style={{
        padding: "7px 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        borderBottom: `1px solid ${c.border}`,
        flexShrink: 0,
        background: c.bg,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: statusColors[status],
            display: "inline-block",
          }}
        />
        <span style={{ fontSize: 10.5, color: c.textMuted, fontFamily: ui }}>
          {statusLabels[status]}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          aria-pressed={aiOn}
          aria-label={aiOn ? "Turn AI off" : "Turn AI on"}
          onClick={onToggleAi}
          title={aiOn ? "AI mode is on" : "AI mode is off"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: 0,
            border: "none",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          <span style={{ fontSize: 10, color: c.textMuted, fontFamily: ui }}>AI</span>
          <span
            style={{
              width: 30,
              height: 17,
              borderRadius: 9,
              background: aiOn
                ? c.accent
                : "color-mix(in srgb, var(--vscode-foreground) 18%, transparent)",
              position: "relative",
              flexShrink: 0,
              display: "inline-block",
              transition: "background 0.15s ease",
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
                left: aiOn ? 15 : 2,
                boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
                transition: "left 0.15s ease",
              }}
            />
          </span>
        </button>
        <div style={{ position: "relative", maxWidth: 130, minWidth: 0 }}>
          <select
            aria-label="AI model"
            value={value}
            onChange={handleChange}
            title={models.find((m) => m.provider === currentProvider && m.model === currentModel)?.label ?? ""}
            style={{
              appearance: "none",
              WebkitAppearance: "none",
              MozAppearance: "none",
              background: c.inputBg,
              color: c.text,
              border: `1px solid ${c.border2}`,
              borderRadius: 5,
              padding: "4px 20px 4px 8px",
              fontSize: 10.5,
              fontFamily: ui,
              cursor: "pointer",
              width: "100%",
              maxWidth: 130,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {models.map((m) => (
              <option key={`${m.provider}:${m.model}`} value={JSON.stringify({ provider: m.provider, model: m.model })}>
                {m.label}
              </option>
            ))}
          </select>
          <svg
            style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
            width="9"
            height="6"
            viewBox="0 0 9 6"
          >
            <path d="M1 1l3.5 3.5L8 1" stroke={c.textMuted} strokeWidth="1.4" fill="none" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    </div>
  );
}
