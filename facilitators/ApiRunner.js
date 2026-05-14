import 'dotenv/config';
import { LLMRouter } from '../llm/LLMRouter.js';

export class ApiRunner {
  constructor(router = new LLMRouter()) {
    this.router = router;
  }

  // Execute a raw HTTP request spec. If body is omitted, Gemini generates it from testContext.
  async run(spec, testContext = {}) {
    const { method = 'GET', url, headers = {}, body, assertions = [] } = spec;

    const requestBody = body ?? await this.#generateBody(spec, testContext);

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      ...(requestBody != null ? { body: JSON.stringify(requestBody) } : {}),
    });

    const raw = await res.text();
    let parsedBody;
    try { parsedBody = JSON.parse(raw); } catch { parsedBody = raw; }

    const response = { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: parsedBody };
    const assertionResults = assertions.length
      ? await this.#assertResponse(response, assertions)
      : [];

    return {
      passed: assertionResults.length === 0 || assertionResults.every((a) => a.passed),
      request: { method, url, body: requestBody },
      response,
      assertions: assertionResults,
    };
  }

  // Run a Postman collection via Newman (install: npm install newman)
  async runCollection(collectionPath, options = {}) {
    let newman;
    try {
      newman = (await import('newman')).default;
    } catch {
      throw new Error('newman is not installed. Run: npm install newman');
    }

    return new Promise((resolve, reject) => {
      newman.run(
        { collection: collectionPath, reporters: 'cli', ...options },
        (err, summary) => {
          if (err) return reject(err);
          resolve({
            passed: summary.run.failures.length === 0,
            stats: summary.run.stats,
            failures: summary.run.failures.map((f) => ({
              name: f.error?.name,
              message: f.error?.message,
            })),
          });
        },
      );
    });
  }

  async #generateBody(spec, testContext) {
    if (!testContext || Object.keys(testContext).length === 0) return null;

    const prompt = `Generate a JSON request body for this API call.
Method: ${spec.method ?? 'GET'}
URL: ${spec.url}
Test context: ${JSON.stringify(testContext, null, 2)}

Return ONLY the JSON object — no explanation, no markdown.`;

    const { text } = await this.router.complete(prompt, 'api-request-generation');
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  }

  async #assertResponse(response, assertions) {
    const prompt = `You are an API test validator. Check each assertion against the response.

Response status: ${response.status}
Response body: ${JSON.stringify(response.body).slice(0, 1500)}

Assertions:
${assertions.map((a, i) => `${i + 1}. ${a}`).join('\n')}

Return ONLY a valid JSON array — no explanation:
[{"assertion": "...", "passed": true, "reason": "..."}]`;

    const { text } = await this.router.complete(prompt, 'api-response-analysis');
    const match = text.match(/\[[\s\S]*\]/);
    return match
      ? JSON.parse(match[0])
      : assertions.map((a) => ({ assertion: a, passed: false, reason: 'Evaluation failed' }));
  }
}
