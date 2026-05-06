export interface LLMClient {
  generate(system: string, user: string): Promise<string>;
}

/**
 * Create an LLM client based on available environment variables.
 * Checks in order: GEMINI_API_KEY (Google), ANTHROPIC_API_KEY (Anthropic).
 */
export async function createClient(): Promise<LLMClient> {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (geminiKey) {
    return createGeminiClient(geminiKey);
  }

  if (anthropicKey) {
    return createAnthropicClient(anthropicKey);
  }

  throw new Error(
    "No LLM API key found. Set GEMINI_API_KEY or ANTHROPIC_API_KEY environment variable.",
  );
}

/**
 * Create a Gemini client using the @google/genai SDK.
 */
function createGeminiClient(apiKey: string): LLMClient {
  const model = process.env.DOCGEN_MODEL || "gemini-2.5-flash";

  return {
    async generate(system: string, user: string): Promise<string> {
      const { GoogleGenAI } = await import("@google/genai");
      const genAI = new GoogleGenAI({ apiKey });

      const response = await genAI.models.generateContent({
        model,
        contents: user,
        config: {
          systemInstruction: system,
          maxOutputTokens: 16384,
        },
      });

      return response.text ?? "";
    },
  };
}

/**
 * Create an Anthropic client using the @anthropic-ai/sdk.
 */
function createAnthropicClient(apiKey: string): LLMClient {
  const model = process.env.DOCGEN_MODEL || "claude-sonnet-4-20250514";

  return {
    async generate(system: string, user: string): Promise<string> {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey });

      const response = await client.messages.create({
        model,
        max_tokens: 8192,
        system,
        messages: [{ role: "user", content: user }],
      });

      const firstBlock = response.content[0];
      return firstBlock && firstBlock.type === "text" ? firstBlock.text : "";
    },
  };
}
