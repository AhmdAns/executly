import 'dotenv/config';
import { ClaudeProvider } from './ClaudeProvider.js';
import { GeminiProvider } from './GeminiProvider.js';
import { getGeminiUsage, incrementGeminiUsage } from './usageTracker.js';

// Task type → preferred provider
const TASK_ROUTING = {
  // Phase 1 — Step Beautifier
  'step-normalization': 'gemini',
  'json-extraction': 'gemini',
  'plain-english-summary': 'gemini',
  'vague-steps': 'claude',
  // Phase 2 — Playwright Executor
  'action-translation': 'gemini',   // clear Playwright command generation
  'selector-resolution': 'claude',  // ambiguous element targeting
  // Phase 3 — Facilitators
  'api-request-generation': 'gemini',
  'api-response-analysis': 'gemini',
  'db-query-simple': 'gemini',
  'db-query-complex': 'claude',
  'log-correlation': 'claude',
  // Phase 4 — Result Reporter
  'test-summary': 'gemini',
  'failure-root-cause': 'claude',
};

export class LLMRouter {
  constructor() {
    this.claude = new ClaudeProvider();
    this.gemini = new GeminiProvider();
    this.dailyLimit = parseInt(process.env.GEMINI_DAILY_LIMIT ?? '1400', 10);
  }

  // Returns which provider will be used for a given task type (without calling it)
  resolve(taskType) {
    const force = (process.env.LLM_FORCE ?? 'none').toLowerCase();
    if (force === 'claude') return 'claude';
    if (force === 'gemini') return 'gemini';

    const prefer = (process.env.LLM_PREFER ?? 'gemini').toLowerCase();
    const routed = TASK_ROUTING[taskType] ?? prefer;

    if (routed === 'gemini' && getGeminiUsage() >= this.dailyLimit) {
      console.warn(`[LLMRouter] Gemini daily limit reached (${this.dailyLimit}). Falling back to Claude.`);
      return 'claude';
    }

    return routed;
  }

  async complete(prompt, taskType = 'plain-english-summary', options = {}) {
    const provider = this.resolve(taskType);
    console.log(`[LLMRouter] task="${taskType}" → provider=${provider}`);

    if (provider === 'gemini') {
      const result = await this.gemini.complete(prompt, options);
      incrementGeminiUsage();
      return result;
    }

    return this.claude.complete(prompt, options);
  }

  get routingTable() {
    return { ...TASK_ROUTING };
  }
}

// Self-test when run directly
if (process.argv[1].endsWith('LLMRouter.js')) {
  const router = new LLMRouter();
  console.log('\nTask routing table:');
  for (const [task, provider] of Object.entries(router.routingTable)) {
    const resolved = router.resolve(task);
    console.log(`  ${task.padEnd(26)} → ${resolved}`);
  }
  console.log(`\nGemini usage today: ${getGeminiUsage()} / ${process.env.GEMINI_DAILY_LIMIT ?? 1400}`);
}
