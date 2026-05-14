import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLMProvider } from './LLMProvider.js';

export class GeminiProvider extends LLMProvider {
  constructor() {
    super('gemini');
    this.client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.defaultModel = process.env.GEMINI_MODEL ?? 'gemini-1.5-flash';
  }

  async complete(prompt, options = {}) {
    const modelName = options.model ?? this.defaultModel;
    const model = this.client.getGenerativeModel({ model: modelName });

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    const usage = response.usageMetadata ?? {};
    return {
      text,
      usage: {
        inputTokens: usage.promptTokenCount ?? 0,
        outputTokens: usage.candidatesTokenCount ?? 0,
      },
      model: modelName,
      provider: 'gemini',
    };
  }
}
