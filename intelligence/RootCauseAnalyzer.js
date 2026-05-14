import 'dotenv/config';
import { LLMRouter } from '../llm/LLMRouter.js';

const CATEGORIES = [
  'ui-regression',    // element missing, layout changed, selector stale
  'api-failure',      // bad response, timeout, auth error
  'data-issue',       // missing test data, wrong state, stale fixture
  'environment',      // service down, misconfiguration, network
  'test-script',      // wrong selector, missing wait, race condition
  'unknown',
];

export class RootCauseAnalyzer {
  constructor(router = new LLMRouter()) {
    this.router = router;
  }

  // Deep analysis of a single failed test case result.
  // context: { logs?, networkErrors?, pageTitle?, url?, selectorHealed? }
  async analyze(result, context = {}) {
    if (result.passed) return null;

    const failedStep = result.stepResults?.find((s) => !s.passed);
    if (!failedStep) return null;

    const prompt = this.#buildPrompt(result, failedStep, context);
    const { text } = await this.router.complete(prompt, 'root-cause-deep');

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return this.#fallback(failedStep);

    try {
      const parsed = JSON.parse(match[0]);
      // Normalise category to known list
      if (!CATEGORIES.includes(parsed.category)) parsed.category = 'unknown';
      return parsed;
    } catch {
      return this.#fallback(failedStep);
    }
  }

  // Batch-analyse an array of test case results, skipping passed ones.
  async analyzeAll(results, contextMap = {}) {
    const analyses = await Promise.all(
      results.map((r) => this.analyze(r, contextMap[r.testCaseId] ?? {}))
    );
    return results.map((r, i) => ({ testCaseId: r.testCaseId, analysis: analyses[i] }))
      .filter((r) => r.analysis !== null);
  }

  #buildPrompt(result, failedStep, context) {
    const { logs, networkErrors, pageTitle, url, selectorHealed } = context;

    const logSection = logs
      ? `Log analysis:\n${JSON.stringify(logs, null, 2).slice(0, 800)}`
      : 'No log evidence.';

    const networkSection = networkErrors?.length
      ? `Network errors:\n${JSON.stringify(networkErrors.slice(0, 5), null, 2)}`
      : 'No network errors recorded.';

    return `You are a senior QA engineer performing deep root-cause analysis.

Test case: ${result.testCaseId} — "${result.title}"
Page URL at failure: ${url ?? 'unknown'}
Page title at failure: ${pageTitle ?? 'unknown'}
Selector was auto-healed during this run: ${selectorHealed ? 'YES' : 'no'}

Failed step:
${JSON.stringify(failedStep.step, null, 2)}

Error message: ${failedStep.error ?? 'none'}
Retries attempted: ${failedStep.attempt ?? 1}
Screenshot captured: ${failedStep.screenshot ? 'yes' : 'no'}

${logSection}

${networkSection}

Classify the root cause and provide a detailed diagnosis. Root cause categories:
${CATEGORIES.map((c) => `- ${c}`).join('\n')}

Return ONLY valid JSON — no explanation outside the JSON:
{
  "category": "ui-regression|api-failure|data-issue|environment|test-script|unknown",
  "confidence": "high|medium|low",
  "summary": "one sentence description of the root cause",
  "evidence": ["specific observation 1", "specific observation 2"],
  "affectedComponent": "component or service name",
  "recommendation": "specific actionable fix",
  "preventionTip": "how to avoid this class of failure in future"
}`;
  }

  #fallback(failedStep) {
    return {
      category: 'unknown',
      confidence: 'low',
      summary: `Step "${failedStep.step?.action}" failed: ${failedStep.error ?? 'unknown error'}`,
      evidence: [failedStep.error ?? 'no error detail'],
      affectedComponent: 'unknown',
      recommendation: 'Inspect the screenshot and error message manually.',
      preventionTip: 'Add explicit wait steps before fragile interactions.',
    };
  }
}
