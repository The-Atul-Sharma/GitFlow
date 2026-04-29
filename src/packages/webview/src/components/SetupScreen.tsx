import { btnStyle, c, ui } from "../styles.js";

interface SetupScreenProps {
  provider: string;
  aiConfigured: boolean;
  platformConfigured: boolean;
  onConfigure: () => void;
}

interface StatusRowProps {
  label: string;
  hint: string;
  ok: boolean;
}

function StatusRow({ label, hint, ok }: StatusRowProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <div
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: ok
            ? "color-mix(in srgb, var(--vscode-testing-iconPassed, #3fc88f) 15%, transparent)"
            : "color-mix(in srgb, var(--vscode-errorForeground, #f48771) 15%, transparent)",
          border: `1px solid ${ok ? "color-mix(in srgb, var(--vscode-testing-iconPassed, #3fc88f) 30%, transparent)" : "color-mix(in srgb, var(--vscode-errorForeground, #f48771) 25%, transparent)"}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
        aria-hidden="true"
      >
        <span style={{ fontSize: 9, color: ok ? c.green : c.red, fontWeight: 700 }}>
          {ok ? "✓" : "✕"}
        </span>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11.5, color: ok ? c.text : c.textMuted, fontFamily: ui }}>
          {label}
        </div>
        <div style={{ fontSize: 9.5, color: c.textSubtle, fontFamily: ui, marginTop: 1 }}>
          {hint}
        </div>
      </div>
      {ok ? (
        <span style={{ fontSize: 9.5, color: c.green, fontFamily: ui }}>connected</span>
      ) : null}
    </div>
  );
}

export function SetupScreen({
  provider,
  aiConfigured,
  platformConfigured,
  onConfigure,
}: SetupScreenProps) {
  const isOllama = provider === "ollama";
  const everythingMissing = !aiConfigured && !platformConfigured;
  const headline = everythingMissing
    ? isOllama
      ? "Setup Ollama"
      : "Setup required"
    : "Almost ready";
  const blurb = isOllama
    ? "Run fully local — no AI key needed. Only a platform token is required. Stored securely in your system keychain."
    : everythingMissing
      ? "GitPilot needs an AI provider key and a platform token. All credentials are stored securely in your system keychain."
      : "Add the missing token to keep going. Credentials are stored in your system keychain.";
  const icon = isOllama ? "⬡" : everythingMissing ? "🔑" : "⚡";
  const iconBg = isOllama
    ? "color-mix(in srgb, var(--vscode-testing-iconPassed, #3fc88f) 8%, transparent)"
    : everythingMissing
      ? "color-mix(in srgb, var(--vscode-button-background, #007acc) 12%, transparent)"
      : "color-mix(in srgb, var(--vscode-editorWarning-foreground, #d7ba7d) 12%, transparent)";
  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "20px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 12,
          paddingTop: 12,
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: iconBg,
            border: `1px solid ${c.border2}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
          }}
          aria-hidden="true"
        >
          {icon}
        </div>
        <div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: c.text,
              fontFamily: ui,
              marginBottom: 6,
            }}
          >
            {headline}
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: c.textMuted,
              fontFamily: ui,
              lineHeight: 1.65,
              maxWidth: 260,
              margin: "0 auto",
            }}
          >
            {blurb}
          </div>
        </div>
      </div>
      <div
        style={{
          background: c.surface,
          borderRadius: 7,
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          border: `1px solid ${c.border2}`,
        }}
      >
        {!isOllama ? (
          <>
            <StatusRow
              label="AI provider key"
              hint="Claude · GPT-4o · Gemini"
              ok={aiConfigured}
            />
            <div style={{ height: 1, background: c.border, margin: "2px 0" }} />
          </>
        ) : null}
        <StatusRow
          label="Platform token"
          hint="GitHub · ghp_  or  GitLab · glpat-"
          ok={platformConfigured}
        />
      </div>
      <button
        type="button"
        onClick={onConfigure}
        style={{
          ...btnStyle("accent", true),
          height: 34,
          fontSize: 12.5,
        }}
      >
        Configure
      </button>
      {aiConfigured && !platformConfigured ? (
        <div
          style={{
            background: "color-mix(in srgb, var(--vscode-testing-iconPassed, #3fc88f) 8%, transparent)",
            border: `1px solid color-mix(in srgb, var(--vscode-testing-iconPassed, #3fc88f) 22%, transparent)`,
            borderRadius: 6,
            padding: "8px 12px",
            fontSize: 11,
            color: c.green,
            fontFamily: ui,
            lineHeight: 1.5,
          }}
        >
          ✓ AI key stored in system keychain
        </div>
      ) : null}
    </div>
  );
}
