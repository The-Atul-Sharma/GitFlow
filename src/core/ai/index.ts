import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";

export type ProviderName = "claude" | "openai" | "gemini" | "ollama";

export interface AIOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface AIProvider {
  name: ProviderName;
  complete(prompt: string, options?: AIOptions): Promise<string>;
}

export interface AIConfig {
  provider: ProviderName;
  model: string;
  fallback?: ProviderName;
}

export class AIProviderError extends Error {
  readonly provider: ProviderName | undefined;

  constructor(message: string, provider?: ProviderName) {
    super(message);
    this.name = "AIProviderError";
    this.provider = provider;
  }
}

const providerNameSchema = z.enum(["claude", "openai", "gemini", "ollama"]);

const aiConfigSchema = z.object({
  provider: providerNameSchema,
  model: z
    .string()
    .min(
      1,
      'model is required. Set "model" in gpilot.config.yml to a non-empty string.',
    ),
  fallback: providerNameSchema.optional(),
});

const aiOptionsSchema = z
  .object({
    maxTokens: z
      .number()
      .int("maxTokens must be an integer. Pass e.g. 1000.")
      .positive("maxTokens must be > 0. Pass a positive integer such as 1000.")
      .optional(),
    temperature: z
      .number()
      .min(0, "temperature must be >= 0. Use 0 for deterministic output.")
      .max(2, "temperature must be <= 2. Use 0.0–1.0 for most use cases.")
      .optional(),
    systemPrompt: z.string().optional(),
  })
  .optional();

const promptSchema = z
  .string()
  .min(1, "prompt is empty. Pass a non-empty string to complete().");

const DEFAULT_MAX_TOKENS = 1000;

const ENV_KEY: Record<Exclude<ProviderName, "ollama">, string> = {
  claude: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

const KNOWN_MODELS: Record<ProviderName, readonly string[]> = {
  claude: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  openai: ["gpt-5", "gpt-4o", "gpt-4-turbo"],
  gemini: ["gemini-2.5-pro", "gemini-2.0-flash"],
  ollama: ["llama3", "mistral", "codellama"],
};

const OLLAMA_ENDPOINT = "http://localhost:11434/api/generate";
const OLLAMA_TAGS_ENDPOINT = "http://localhost:11434/api/tags";

interface OllamaTagsResponse {
  models?: Array<{
    name?: string;
    model?: string;
  }>;
}

async function listInstalledOllamaModels(): Promise<string[]> {
  try {
    const response = await fetch(OLLAMA_TAGS_ENDPOINT);
    if (!response.ok) return [];
    const data = (await response.json()) as OllamaTagsResponse;
    const names = (data.models ?? [])
      .map((m) => m.name ?? m.model ?? "")
      .filter((name) => name.length > 0);
    return Array.from(new Set(names)).sort();
  } catch {
    return [];
  }
}

function requireApiKey(provider: Exclude<ProviderName, "ollama">): string {
  const envName = ENV_KEY[provider];
  const value = process.env[envName];
  if (!value) {
    throw new AIProviderError(
      `${envName} not found. Run: npx gpilot auth`,
      provider,
    );
  }
  return value;
}

function looksLikeModelError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("model") &&
    (msg.includes("not found") ||
      msg.includes("does not exist") ||
      msg.includes("invalid") ||
      msg.includes("unknown") ||
      msg.includes("unsupported"))
  );
}

function looksLikeQuotaOrRateLimitError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("too many requests") ||
    msg.includes("quota exceeded") ||
    msg.includes("rate limit") ||
    msg.includes("resource_exhausted")
  );
}

function wrapProviderError(
  err: unknown,
  provider: ProviderName,
  model: string,
): never {
  if (err instanceof AIProviderError) throw err;
  if (looksLikeModelError(err)) {
    const valid = KNOWN_MODELS[provider].join(", ");
    throw new AIProviderError(
      `Invalid model "${model}" for ${provider}. Set "model" in gpilot.config.yml to one of: ${valid}.`,
      provider,
    );
  }
  if (looksLikeQuotaOrRateLimitError(err)) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new AIProviderError(
      `${provider} quota/rate-limit reached for model "${model}": ${reason}. Retry later, switch to another model/provider, or configure ai.fallback in gpilot.config.yml.`,
      provider,
    );
  }
  const reason = err instanceof Error ? err.message : String(err);
  throw new AIProviderError(
    `${provider} request failed: ${reason}. Check your network connection and that ${provider === "ollama" ? "ollama is running on localhost:11434" : `your ${ENV_KEY[provider as Exclude<ProviderName, "ollama">]} is valid`}.`,
    provider,
  );
}

class ClaudeProvider implements AIProvider {
  readonly name = "claude" as const;
  private readonly client: Anthropic;

  constructor(private readonly model: string) {
    this.client = new Anthropic({ apiKey: requireApiKey("claude") });
  }

  async complete(prompt: string, options?: AIOptions): Promise<string> {
    promptSchema.parse(prompt);
    aiOptionsSchema.parse(options);

    const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;

    try {
      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: maxTokens,
        ...(options?.temperature !== undefined
          ? { temperature: options.temperature }
          : {}),
        ...(options?.systemPrompt
          ? {
              system: [
                {
                  type: "text",
                  text: options.systemPrompt,
                  cache_control: { type: "ephemeral" },
                },
              ],
            }
          : {}),
        messages: [{ role: "user", content: prompt }],
      });

      const block = message.content[0];
      if (!block || block.type !== "text") {
        throw new AIProviderError(
          `claude returned no text content. Try a simpler prompt or verify the model "${this.model}" supports text output.`,
          "claude",
        );
      }
      return block.text;
    } catch (err) {
      wrapProviderError(err, "claude", this.model);
    }
  }
}

class OpenAIProvider implements AIProvider {
  readonly name = "openai" as const;
  private readonly client: OpenAI;

  constructor(private readonly model: string) {
    this.client = new OpenAI({ apiKey: requireApiKey("openai") });
  }

  async complete(prompt: string, options?: AIOptions): Promise<string> {
    promptSchema.parse(prompt);
    aiOptionsSchema.parse(options);

    const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;
    const messages: { role: "system" | "user"; content: string }[] = [];
    if (options?.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        max_tokens: maxTokens,
        ...(options?.temperature !== undefined
          ? { temperature: options.temperature }
          : {}),
      });
      const text = response.choices[0]?.message.content;
      if (!text) {
        throw new AIProviderError(
          `openai returned no content. Try a simpler prompt or verify the model "${this.model}" is a chat model.`,
          "openai",
        );
      }
      return text;
    } catch (err) {
      wrapProviderError(err, "openai", this.model);
    }
  }
}

class GeminiProvider implements AIProvider {
  readonly name = "gemini" as const;
  private readonly client: GoogleGenerativeAI;

  constructor(private readonly model: string) {
    this.client = new GoogleGenerativeAI(requireApiKey("gemini"));
  }

  async complete(prompt: string, options?: AIOptions): Promise<string> {
    promptSchema.parse(prompt);
    aiOptionsSchema.parse(options);

    const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;

    try {
      const model = this.client.getGenerativeModel({
        model: this.model,
        ...(options?.systemPrompt
          ? { systemInstruction: options.systemPrompt }
          : {}),
        generationConfig: {
          maxOutputTokens: maxTokens,
          ...(options?.temperature !== undefined
            ? { temperature: options.temperature }
            : {}),
        },
      });
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      if (!text) {
        throw new AIProviderError(
          `gemini returned no content. Try a simpler prompt or verify the model "${this.model}" supports generateContent.`,
          "gemini",
        );
      }
      return text;
    } catch (err) {
      wrapProviderError(err, "gemini", this.model);
    }
  }
}

class OllamaProvider implements AIProvider {
  readonly name = "ollama" as const;

  constructor(private readonly model: string) {}

  async complete(prompt: string, options?: AIOptions): Promise<string> {
    promptSchema.parse(prompt);
    aiOptionsSchema.parse(options);

    const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;
    const body = {
      model: this.model,
      prompt,
      stream: false,
      ...(options?.systemPrompt ? { system: options.systemPrompt } : {}),
      options: {
        num_predict: maxTokens,
        ...(options?.temperature !== undefined
          ? { temperature: options.temperature }
          : {}),
      },
    };

    let response;
    try {
      response = await fetch(OLLAMA_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      wrapProviderError(err, "ollama", this.model);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      if (response.status === 404 || /model.*not found/i.test(errorText)) {
        const installed = await listInstalledOllamaModels();
        const valid = KNOWN_MODELS.ollama.join(", ");
        const installedMessage =
          installed.length > 0
            ? `installed locally: ${installed.join(", ")}`
            : "no local models found";
        throw new AIProviderError(
          `Invalid model "${this.model}" for ollama. Pull it first: ollama pull ${this.model} (known examples: ${valid}; ${installedMessage}).`,
          "ollama",
        );
      }
      throw new AIProviderError(
        `ollama request failed (${response.status}): ${errorText || response.statusText}. Check that ollama is running on localhost:11434.`,
        "ollama",
      );
    }

    const data = (await response.json()) as { response?: string };
    if (!data.response) {
      throw new AIProviderError(
        `ollama returned no response field. Verify the model "${this.model}" is installed with: ollama list.`,
        "ollama",
      );
    }
    return data.response;
  }
}

/**
 * Construct an AIProvider for the given configuration.
 *
 * Reads the matching API key from process.env (populated by the secrets module).
 * For ollama, no API key is required.
 *
 * @param config - provider name, model, and optional fallback from gpilot.config.yml
 * @returns an AIProvider implementation matching config.provider
 * @throws AIProviderError when the chosen provider's API key is missing
 */
export function createAIProvider(config: AIConfig): AIProvider {
  const parsed = aiConfigSchema.parse(config);
  switch (parsed.provider) {
    case "claude":
      return new ClaudeProvider(parsed.model);
    case "openai":
      return new OpenAIProvider(parsed.model);
    case "gemini":
      return new GeminiProvider(parsed.model);
    case "ollama":
      return new OllamaProvider(parsed.model);
  }
}

/**
 * Run a completion against the primary provider; on failure, retry once on the fallback.
 *
 * @param primary - provider attempted first
 * @param fallback - provider attempted after primary fails; pass null to disable retry
 * @param prompt - user prompt forwarded to whichever provider runs
 * @param options - generation options forwarded to whichever provider runs
 * @returns the completion text from the first provider that succeeds
 * @throws AIProviderError when both providers fail (or primary fails and fallback is null)
 */
export async function withFallback(
  primary: AIProvider,
  fallback: AIProvider | null,
  prompt: string,
  options?: AIOptions,
): Promise<string> {
  try {
    return await primary.complete(prompt, options);
  } catch (primaryErr) {
    if (!fallback) throw primaryErr;
    try {
      return await fallback.complete(prompt, options);
    } catch (fallbackErr) {
      const primaryMsg =
        primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
      const fallbackMsg =
        fallbackErr instanceof Error
          ? fallbackErr.message
          : String(fallbackErr);
      throw new AIProviderError(
        `Both providers failed. primary (${primary.name}): ${primaryMsg}. fallback (${fallback.name}): ${fallbackMsg}. Verify API keys and network access for both providers.`,
      );
    }
  }
}
