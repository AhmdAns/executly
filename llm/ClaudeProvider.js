import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider } from './LLMProvider.js';

export class ClaudeProvider extends LLMProvider {
  constructor() {
    super('claude');
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.defaultModel = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6';
  }

  async complete(prompt, options = {}) {
    const model = options.model ?? this.defaultModel;
    const maxTokens = options.maxTokens ?? 2048;

    const response = await this.client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    return {
      text,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      model: response.model,
      provider: 'claude',
    };
  }
}
