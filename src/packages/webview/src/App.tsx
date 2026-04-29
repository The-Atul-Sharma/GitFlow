import { useEffect, useMemo, useState } from "react";
import type {
  ExtensionMessage,
  gpilotMode,
  InlineIssue,
  ModelEntry,
  RepoStatus,
} from "./types.js";
import { extensionMessageSchema } from "./types.js";
import { sendMessage } from "./vsCodeApi.js";
import { c, layout } from "./styles.js";
import { Header } from "./components/Header.js";
import { Tabs, type MainTab } from "./components/Tabs.js";
import { Footer } from "./components/Footer.js";
import { AiOffBanner } from "./components/AiOffBanner.js";
import { SetupScreen } from "./components/SetupScreen.js";
import { CommitPanel } from "./components/CommitPanel.js";
import { PrPanel } from "./components/PrPanel.js";
import { ReviewPanel } from "./components/ReviewPanel.js";
import { SpecPanel } from "./components/SpecPanel.js";

interface CurrentModel {
  provider: string;
  model: string;
}

const DEFAULT_MODEL: CurrentModel = {
  provider: "claude",
  model: "claude-sonnet-4-6",
};
const DEFAULT_MODEL_OPTIONS: ReadonlyArray<ModelEntry> = [
  {
    label: "Claude Sonnet 4.6",
    provider: "claude",
    model: "claude-sonnet-4-6",
  },
];
const DEFAULT_STATUS: RepoStatus = {
  branch: null,
  hasCommit: false,
  isBranchPushed: false,
  hasOpenPR: false,
  changedFiles: [],
};

const PROVIDER_LABEL: Record<string, string> = {
  claude: "Anthropic",
  openai: "OpenAI",
  gemini: "Gemini",
  ollama: "Ollama (local)",
};

export function App() {
  const [currentModel, setCurrentModel] = useState<CurrentModel>(DEFAULT_MODEL);
  const [modelOptions, setModelOptions] = useState<ReadonlyArray<ModelEntry>>(
    DEFAULT_MODEL_OPTIONS,
  );
  const [runningCommand, setRunningCommand] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [ready, setReady] = useState<boolean>(false);
  const [aiConfigured, setAiConfigured] = useState<boolean>(false);
  const [platformConfigured, setPlatformConfigured] = useState<boolean>(false);
  const [mode, setMode] = useState<gpilotMode>("gpilot");
  const [repoStatus, setRepoStatus] = useState<RepoStatus>(DEFAULT_STATUS);
  const [commitDraft, setCommitDraft] = useState<string>("");
  const [prDraft, setPrDraft] = useState<{
    title: string;
    description: string;
  }>({
    title: "",
    description: "",
  });
  const [issues, setIssues] = useState<InlineIssue[]>([]);
  const [activeTab, setActiveTab] = useState<MainTab>("Commit");
  const [autoReview, setAutoReview] = useState<boolean>(false);
  const [specFile, setSpecFile] = useState<string | null>(null);
  const [specGeneratedPath, setSpecGeneratedPath] = useState<string | null>(
    null,
  );
  const [specPreview, setSpecPreview] = useState<string>("");
  const [openedDiffs, setOpenedDiffs] = useState<string[]>([]);

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const result = extensionMessageSchema.safeParse(event.data);
      if (!result.success) return;
      handleExtensionMessage(result.data);
    };
    const requestLatestState = (): void => {
      sendMessage({ type: "requestState" });
    };
    window.addEventListener("message", onMessage);
    window.addEventListener("focus", requestLatestState);
    document.addEventListener("visibilitychange", requestLatestState);
    requestLatestState();
    // Poll regardless of visibilityState — VS Code webview views report
    // "hidden" while the sidebar is on a different view, but the user still
    // needs the Ollama-running indicator to be live when they switch back.
    const interval = window.setInterval(requestLatestState, 2500);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("focus", requestLatestState);
      document.removeEventListener("visibilitychange", requestLatestState);
      window.clearInterval(interval);
    };
  }, []);

  function handleExtensionMessage(message: ExtensionMessage): void {
    switch (message.type) {
      case "configUpdate":
        setCurrentModel({ provider: message.provider, model: message.model });
        return;
      case "modelOptionsUpdate":
        setModelOptions(message.models);
        return;
      case "commandRunning":
        setRunningCommand(message.command);
        setLastError(null);
        return;
      case "commandDone":
        setRunningCommand((current) =>
          current === message.command ? null : current,
        );
        return;
      case "commandFailed":
        setRunningCommand((current) =>
          current === message.command ? null : current,
        );
        setLastError(`${message.command}: ${message.error}`);
        return;
      case "setupStatus":
        setReady(message.ready);
        setAiConfigured(message.aiConfigured);
        setPlatformConfigured(message.platformConfigured);
        return;
      case "commitDraft":
        setCommitDraft(message.message);
        return;
      case "prDraft":
        setPrDraft({ title: message.title, description: message.description });
        return;
      case "reviewResult":
        setIssues(message.issues);
        return;
      case "repoStatus":
        setRepoStatus(message.status);
        return;
      case "modeUpdate":
        setMode(message.mode);
        return;
      case "specFilePicked":
        setSpecFile(message.path);
        setSpecGeneratedPath(null);
        setSpecPreview("");
        return;
      case "specGenerated":
        setSpecGeneratedPath(message.path);
        setSpecPreview(message.preview);
        return;
      case "openDiffsUpdate":
        setOpenedDiffs(message.paths);
        return;
    }
  }

  function handleSwitchModel(provider: string, model: string): void {
    sendMessage({ type: "switchModel", provider, model });
    setCurrentModel({ provider, model });
  }

  function handleSetupKeys(): void {
    sendMessage({ type: "setupKeys" });
  }

  function handleToggleAi(): void {
    const next: gpilotMode = mode === "gpilot" ? "native" : "gpilot";
    sendMessage({ type: "setMode", mode: next });
    setMode(next);
  }

  const aiOn = mode === "gpilot";
  const locked = !aiOn;
  const needsSetup = aiOn && !ready;

  const headerStatus: "ready" | "running" | "error" | "setup" = needsSetup
    ? "setup"
    : runningCommand
      ? "running"
      : lastError
        ? "error"
        : "ready";

  const providerLabel =
    PROVIDER_LABEL[currentModel.provider] ?? currentModel.provider;
  const providerStatus =
    currentModel.provider === "ollama"
      ? aiConfigured
        ? `${providerLabel} running`
        : "Ollama not running"
      : aiConfigured
        ? `${providerLabel} connected`
        : "Not connected";
  // For Ollama, "ok" means the local server is reachable. For hosted providers,
  // it means a key exists in the keychain. Either way `aiConfigured` already
  // encodes that — see ExtensionContext.postSetupStatus.
  const providerOk = aiConfigured;

  const contentStyle = useMemo(
    () => ({
      ...layout.content,
      opacity: locked ? 0.32 : 1,
      pointerEvents: (locked ? "none" : "auto") as "none" | "auto",
    }),
    [locked],
  );

  return (
    <div style={layout.shell}>
      <Header
        status={headerStatus}
        aiOn={aiOn}
        onToggleAi={handleToggleAi}
        currentProvider={currentModel.provider}
        currentModel={currentModel.model}
        models={modelOptions}
        onModelChange={handleSwitchModel}
      />

      {needsSetup ? (
        <SetupScreen
          provider={currentModel.provider}
          aiConfigured={aiConfigured}
          platformConfigured={platformConfigured}
          onConfigure={handleSetupKeys}
        />
      ) : (
        <>
          <Tabs active={activeTab} locked={locked} onChange={setActiveTab} />
          {locked ? <AiOffBanner /> : null}
          <div style={contentStyle}>
            {lastError ? (
              <div
                role="alert"
                style={{
                  color: c.red,
                  fontSize: 11,
                  border: `1px solid color-mix(in srgb, var(--vscode-errorForeground, #f48771) 35%, transparent)`,
                  borderRadius: 6,
                  padding: "6px 10px",
                  background:
                    "color-mix(in srgb, var(--vscode-errorForeground, #f48771) 8%, transparent)",
                }}
                data-testid="error-banner"
              >
                {lastError}
              </div>
            ) : null}

            {activeTab === "Commit" ? (
              <CommitPanel
                changedFiles={repoStatus.changedFiles}
                draft={commitDraft}
                running={runningCommand === "commit"}
                openedDiffs={openedDiffs}
                onGenerate={() => sendMessage({ type: "generateCommit" })}
                onCommit={(message) =>
                  sendMessage({ type: "commitMessage", message })
                }
                onDraftChange={setCommitDraft}
                onOpenFileDiff={(path, staged, status) => {
                  // Toggle: clicking an already-open file closes its diff,
                  // matching VS Code's behavior of one click = one tab action.
                  if (openedDiffs.includes(path)) {
                    sendMessage({ type: "closeFileDiff", path });
                  } else {
                    sendMessage({
                      type: "openFileDiff",
                      path,
                      staged,
                      status,
                    });
                  }
                }}
                onStageFile={(path) => sendMessage({ type: "stageFile", path })}
                onUnstageFile={(path) =>
                  sendMessage({ type: "unstageFile", path })
                }
              />
            ) : null}

            {activeTab === "Pull Request" ? (
              <PrPanel
                status={repoStatus}
                draft={prDraft}
                running={runningCommand === "pr"}
                pushing={runningCommand === "push"}
                onGenerate={() => sendMessage({ type: "generatePr" })}
                onCreate={(title, description) =>
                  sendMessage({ type: "createPr", title, description })
                }
                onPush={() => sendMessage({ type: "pushBranch" })}
                onDraftChange={setPrDraft}
              />
            ) : null}

            {activeTab === "PR Review" ? (
              <ReviewPanel
                status={repoStatus}
                issues={issues}
                running={runningCommand === "review"}
                publishing={runningCommand === "publishReview"}
                autoMode={autoReview}
                onToggleAutoMode={() => setAutoReview((v) => !v)}
                onRun={() => {
                  if (autoReview) {
                    sendMessage({ type: "runReview" });
                    sendMessage({ type: "publishReview" });
                  } else {
                    sendMessage({ type: "runReview" });
                  }
                }}
                onPublish={() => sendMessage({ type: "publishReview" })}
                onOpenPr={() => sendMessage({ type: "openPr" })}
                onPreviewFix={(issueId) =>
                  sendMessage({ type: "previewFix", issueId })
                }
              />
            ) : null}

            {activeTab === "Spec MD" ? (
              <SpecPanel
                pickedFile={specFile}
                generatedPath={specGeneratedPath}
                generatedPreview={specPreview}
                running={runningCommand === "spec"}
                onPickFile={() => sendMessage({ type: "pickSpecFile" })}
                onGenerate={(path, sections) =>
                  sendMessage({ type: "generateSpec", path, sections })
                }
                onOpen={(path) => sendMessage({ type: "openSpec", path })}
              />
            ) : null}
          </div>
        </>
      )}

      <Footer
        provider={providerStatus}
        ok={providerOk}
        onManage={handleSetupKeys}
      />
    </div>
  );
}
