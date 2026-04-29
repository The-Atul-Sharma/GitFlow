import { c, ui } from "../styles.js";

interface FooterProps {
  provider: string;
  ok: boolean;
  onManage: () => void;
}

export function Footer({ provider, ok, onManage }: FooterProps) {
  return (
    <div
      style={{
        padding: "8px 12px",
        borderTop: `1px solid ${c.border}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: c.bg,
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: ok ? c.green : c.red,
            display: "inline-block",
          }}
        />
        <span style={{ fontSize: 10.5, color: c.textMuted, fontFamily: ui }}>{provider}</span>
      </div>
      <button
        type="button"
        onClick={onManage}
        style={{
          background: "transparent",
          border: "none",
          color: c.textMuted,
          fontSize: 10.5,
          fontFamily: ui,
          fontWeight: 500,
          cursor: "pointer",
          padding: "2px 4px",
        }}
      >
        Manage Keys
      </button>
    </div>
  );
}
