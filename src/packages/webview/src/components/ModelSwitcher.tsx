import type { ChangeEvent } from 'react';
import { layout } from '../styles.js';
import { ModelOption } from './ModelOption.js';

interface ModelSwitcherProps {
  currentProvider: string;
  currentModel: string;
  models: ReadonlyArray<ModelEntry>;
  onChange: (provider: string, model: string) => void;
}

interface ModelEntry {
  label: string;
  provider: string;
  model: string;
}

/**
 * Section that lets the user switch the active AI model. Forwards the
 * selection to the parent which is responsible for sending switchModel.
 */
export function ModelSwitcher({
  currentProvider,
  currentModel,
  models,
  onChange,
}: ModelSwitcherProps) {
  const value = JSON.stringify({ provider: currentProvider, model: currentModel });

  const handleChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    try {
      const parsed = JSON.parse(event.target.value) as { provider?: unknown; model?: unknown };
      if (typeof parsed.provider !== 'string' || typeof parsed.model !== 'string') return;
      onChange(parsed.provider, parsed.model);
    } catch {
      return;
    }
  };

  return (
    <section style={layout.section} aria-label="AI Model">
      <h2 style={layout.sectionTitle}>AI Model</h2>
      <select
        aria-label="Select AI model"
        style={layout.select}
        value={value}
        onChange={handleChange}
      >
        {models.map((m) => (
          <ModelOption
            key={`${m.provider}:${m.model}`}
            value={JSON.stringify({ provider: m.provider, model: m.model })}
            label={m.label}
          />
        ))}
      </select>
    </section>
  );
}
