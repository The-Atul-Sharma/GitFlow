# Module: ai

## Purpose

Abstract AI provider interface so gpilot can swap between
Claude, OpenAI, Gemini, and Ollama via config.

## Public API

```ts
export interface AIProvider {
  name: "claude" | "openai" | "gemini" | "ollama";
  complete(prompt: string, options?: AIOptions): Promise<string>;
}

export interface AIOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export function createAIProvider(config: AIConfig): AIProvider;

export function withFallback(
  primary: AIProvider,
  fallback: AIProvider | null,
  prompt: string,
  options?: AIOptions,
): Promise<string>;
```

## Providers

- ClaudeProvider uses @anthropic-ai/sdk, model from config
- OpenAIProvider uses openai, model from config
- GeminiProvider uses @google/generative-ai
- OllamaProvider local fetch to http://localhost:11434

## Config

AIConfig comes from gpilot.config.yml:

- provider: 'claude' | 'openai' | 'gemini' | 'ollama'
- model: string
- fallback?: 'claude' | 'openai' | 'gemini' | 'ollama'

## Rules

- API keys come from secrets module, never from config file
- If primary provider throws, withFallback retries on fallback once
- Default maxTokens is 1000 if not specified
- All providers must implement the same AIProvider interface
- Throw AIProviderError if API key missing for chosen provider

## Error cases

- Missing API key → AIProviderError "ANTHROPIC_API_KEY not found.
  Run: npx gpilot auth"
- Network failure → wrap original error with provider name
- Invalid model name → throw with list of valid models for provider

## Tests required

- Each provider implements AIProvider interface
- createAIProvider returns correct provider based on config
- Missing API key throws AIProviderError with helpful message
- withFallback uses primary on success
- withFallback uses fallback when primary throws
- withFallback throws if both fail
- Ollama provider needs no API key
