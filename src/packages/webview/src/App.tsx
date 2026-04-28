import { useEffect, useState } from 'react';
import type { ExtensionMessage, InlineIssue, ModelEntry, PipelineStep } from './types.js';
import { extensionMessageSchema } from './types.js';
import { sendMessage } from './vsCodeApi.js';
import { ensureSpinnerKeyframes, layout } from './styles.js';
import { PipelineStatus } from './components/PipelineStatus.js';
import { ReviewCommentList } from './components/ReviewCommentList.js';
import { ModelSwitcher } from './components/ModelSwitcher.js';

interface CurrentModel {
  provider: string;
  model: string;
}

interface AppProps {
  initialPrId?: string;
}

const DEFAULT_MODEL: CurrentModel = { provider: 'claude', model: 'claude-sonnet-4-6' };
const DEFAULT_MODEL_OPTIONS: ReadonlyArray<ModelEntry> = [
  { label: 'Claude Sonnet 4.6', provider: 'claude', model: 'claude-sonnet-4-6' },
];

/**
 * Root webview component. Owns all state, listens for messages from the
 * extension host, and routes outbound actions through sendMessage.
 */
export function App({ initialPrId = '' }: AppProps) {
  const [steps, setSteps] = useState<PipelineStep[]>([]);
  const [issues, setIssues] = useState<InlineIssue[]>([]);
  const [currentModel, setCurrentModel] = useState<CurrentModel>(DEFAULT_MODEL);
  const [modelOptions, setModelOptions] = useState<ReadonlyArray<ModelEntry>>(DEFAULT_MODEL_OPTIONS);
  const [runningCommand, setRunningCommand] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [ready, setReady] = useState<boolean>(false);
  const [aiConfigured, setAiConfigured] = useState<boolean>(false);
  const [platformConfigured, setPlatformConfigured] = useState<boolean>(false);
  const [prId] = useState<string>(initialPrId);

  useEffect(() => {
    ensureSpinnerKeyframes();
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const result = extensionMessageSchema.safeParse(event.data);
      if (!result.success) return;
      handleExtensionMessage(result.data);
    };
    const requestLatestState = (): void => {
      sendMessage({ type: 'requestState' });
    };
    window.addEventListener('message', onMessage);
    window.addEventListener('focus', requestLatestState);
    document.addEventListener('visibilitychange', requestLatestState);
    requestLatestState();
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('focus', requestLatestState);
      document.removeEventListener('visibilitychange', requestLatestState);
    };
  }, []);

  function handleExtensionMessage(message: ExtensionMessage): void {
    switch (message.type) {
      case 'pipelineUpdate':
        setSteps(message.steps);
        return;
      case 'reviewComplete':
        setIssues(message.issues);
        return;
      case 'configUpdate':
        setCurrentModel({ provider: message.provider, model: message.model });
        return;
      case 'modelOptionsUpdate':
        setModelOptions(message.models);
        return;
      case 'commandRunning':
        setRunningCommand(message.command);
        setLastError(null);
        return;
      case 'commandDone':
        setRunningCommand((current) => (current === message.command ? null : current));
        return;
      case 'commandFailed':
        setRunningCommand((current) => (current === message.command ? null : current));
        setLastError(`${message.command}: ${message.error}`);
        return;
      case 'setupStatus':
        setReady(message.ready);
        setAiConfigured(message.aiConfigured);
        setPlatformConfigured(message.platformConfigured);
        return;
    }
  }

  function handleFix(targetPrId: string, commentId: string): void {
    if (!targetPrId) {
      setLastError('Cannot fix comment without a PR id. Open the panel from a PR review first.');
      return;
    }
    sendMessage({ type: 'fixComment', prId: targetPrId, commentId });
  }

  function handleDismiss(commentId: string): void {
    sendMessage({ type: 'dismissComment', commentId });
    setIssues((current) => current.filter((issue) => issue.id !== commentId));
  }

  function handleSwitchModel(provider: string, model: string): void {
    sendMessage({ type: 'switchModel', provider, model });
    setCurrentModel({ provider, model });
  }

  function handleSetupKeys(): void {
    sendMessage({ type: 'setupKeys' });
  }

  function handleRunCommand(command: 'commit' | 'pr' | 'review' | 'status'): void {
    sendMessage({ type: 'runCommand', command });
  }

  return (
    <div style={layout.app}>
      {!ready ? (
        <section style={layout.section} aria-label="Setup Keys">
          <h2 style={layout.sectionTitle}>Setup Required</h2>
          <div style={layout.card}>
            <p style={{ margin: 0 }}>
              Set at least one AI key and one platform key before using the panel.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, opacity: 0.8 }}>
              <span>AI key: {aiConfigured ? 'configured' : 'missing'}</span>
              <span>Platform key: {platformConfigured ? 'configured' : 'missing'}</span>
            </div>
            <div>
              <button style={layout.primaryButton} onClick={handleSetupKeys} type="button">
                Setup keys
              </button>
            </div>
          </div>
        </section>
      ) : null}
      {ready ? (
        <>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button style={layout.secondaryButton} onClick={handleSetupKeys} type="button">
          Manage keys
        </button>
      </div>
      {runningCommand ? (
        <div style={{ opacity: 0.8, fontSize: 12 }} data-testid="running-banner">
          Running: {runningCommand}…
        </div>
      ) : null}
      {lastError ? (
        <div
          style={{ color: 'var(--vscode-errorForeground)', fontSize: 12 }}
          data-testid="error-banner"
        >
          {lastError}
        </div>
      ) : null}
      <PipelineStatus steps={steps} />
      <ReviewCommentList
        issues={issues}
        prId={prId}
        onFix={handleFix}
        onDismiss={handleDismiss}
      />
      <ModelSwitcher
        currentProvider={currentModel.provider}
        currentModel={currentModel.model}
        models={modelOptions}
        onChange={handleSwitchModel}
      />
      <section style={layout.section} aria-label="Pipeline Actions">
        <h2 style={layout.sectionTitle}>Pipeline Actions</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button style={layout.primaryButton} type="button" onClick={() => handleRunCommand('commit')}>
            Generate commit
          </button>
          <button style={layout.primaryButton} type="button" onClick={() => handleRunCommand('pr')}>
            Create PR + description
          </button>
          <button style={layout.secondaryButton} type="button" onClick={() => handleRunCommand('review')}>
            Review before push
          </button>
          <button style={layout.secondaryButton} type="button" onClick={() => handleRunCommand('status')}>
            Show status
          </button>
        </div>
      </section>
        </>
      ) : null}
    </div>
  );
}
