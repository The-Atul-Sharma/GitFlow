import { c, ui } from "../styles.js";

export type MainTab = "Commit" | "Pull Request" | "PR Review" | "Spec MD";

const TABS: ReadonlyArray<MainTab> = ["Commit", "Pull Request", "PR Review", "Spec MD"];

interface TabsProps {
  active: MainTab;
  locked?: boolean;
  onChange: (tab: MainTab) => void;
}

export function Tabs({ active, locked = false, onChange }: TabsProps) {
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        borderBottom: `1px solid ${c.border}`,
        flexShrink: 0,
        background: c.bg,
      }}
    >
      {TABS.map((tab) => {
        const isActive = active === tab;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={locked}
            onClick={() => !locked && onChange(tab)}
            style={{
              flex: 1,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10.5,
              fontFamily: ui,
              fontWeight: isActive ? 600 : 400,
              color: locked ? c.textSubtle : isActive ? c.text : c.textMuted,
              borderBottom:
                isActive && !locked
                  ? `2px solid ${c.accent}`
                  : "2px solid transparent",
              background: "transparent",
              border: "none",
              borderTop: "none",
              borderLeft: "none",
              borderRight: "none",
              cursor: locked ? "not-allowed" : "pointer",
              padding: 0,
            }}
          >
            {tab}
          </button>
        );
      })}
    </div>
  );
}
