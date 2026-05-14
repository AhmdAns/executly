export class LLMProvider {
  constructor(name) {
    this.name = name;
  }

  // @param {string} prompt
  // @param {object} options - model, maxTokens, temperature
  // @returns {Promise<{text: string, usage: {inputTokens: number, outputTokens: number}, model: string, provider: string}>}
  async complete(prompt, options = {}) {
    throw new Error(`complete() not implemented by ${this.name}`);
  }
}
