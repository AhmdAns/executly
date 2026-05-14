import 'dotenv/config';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { LLMRouter } from '../llm/LLMRouter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = join(__dirname, '..', 'reports');

export class ResultReporter {
  constructor(router = new LLMRouter()) {
    this.router = router;
    this.orgUrl = (process.env.AZURE_ORG_URL ?? '').replace(/\/$/, '');
    this.project = process.env.AZURE_PROJECT;
    const pat = process.env.AZURE_DEVOPS_PAT ?? '';
    this.authHeader = `Basic ${Buffer.from(`:${pat}`).toString('base64')}`;
    if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  }

  // Full pipeline: enrich with LLM, push to Azure, save unified report.
  // logEvidence: { 'TC-1042': logCheckerOutput, ... } — optional, attached to failures
  async report(testCaseResults, { planId, suiteName = 'Executly Run', logEvidence = {} } = {}) {
    console.log(`\n[ResultReporter] Processing ${testCaseResults.length} test case(s)...`);

    const enriched = await this.#enrichAll(testCaseResults, logEvidence);

    let runId = null;
    let runUrl = null;
    if (planId && this.orgUrl && this.project) {
      try {
        runId = await this.#createRun(planId, suiteName);
        await this.#publishResults(runId, enriched);
        await this.#completeRun(runId);
        runUrl = `${this.orgUrl}/${this.project}/_testManagement/runs?runId=${runId}`;
        console.log(`[ResultReporter] Azure test run published: ${runUrl}`);
      } catch (err) {
        console.warn(`[ResultReporter] Azure publish skipped: ${err.message}`);
      }
    } else {
      console.log('[ResultReporter] Azure publish skipped (AZURE_ORG_URL / AZURE_PROJECT / planId not set)');
    }

    return this.#buildReport(enriched, { runId, runUrl, suiteName });
  }

  // ── Azure DevOps Test Runs API ─────────────────────────────────────────────

  async #azureFetch(path, method, body) {
    const url = `${this.orgUrl}/${this.project}/_apis/test/${path}?api-version=7.1`;
    const res = await fetch(url, {
      method,
      headers: { Authorization: this.authHeader, 'Content-Type': 'application/json' },
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw new Error(`Azure API ${method} ${path} → ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async #createRun(planId, name) {
    const data = await this.#azureFetch('runs', 'POST', {
      name,
      plan: { id: String(planId) },
      state: 'InProgress',
      automated: true,
    });
    console.log(`[ResultReporter] Created run ID: ${data.id}`);
    return data.id;
  }

  async #publishResults(runId, enriched) {
    const payload = enriched.map((r) => ({
      testCase: { id: r.testCaseId.replace(/^TC-/, '') },
      outcome: r.passed ? 'Passed' : 'Failed',
      state: 'Completed',
      comment: (r.summary ?? '').slice(0, 1000),
      ...(r.rootCause ? { errorMessage: r.rootCause.slice(0, 1000) } : {}),
    }));
    await this.#azureFetch(`runs/${runId}/results`, 'POST', payload);
    console.log(`[ResultReporter] Published ${payload.length} result(s) to run ${runId}`);
  }

  async #completeRun(runId) {
    await this.#azureFetch(`runs/${runId}`, 'PATCH', { state: 'Completed' });
    console.log(`[ResultReporter] Run ${runId} marked Completed`);
  }

  // ── LLM enrichment ─────────────────────────────────────────────────────────

  async #enrichAll(results, logEvidence) {
    // Run enrichment concurrently — each test case is independent
    return Promise.all(results.map((r) => this.#enrichOne(r, logEvidence[r.testCaseId])));
  }

  async #enrichOne(result, logs) {
    const summary = await this.#generateSummary(result);
    if (result.passed) return { ...result, summary };
    const rootCause = await this.#generateRootCause(result, logs);
    return { ...result, summary, rootCause };
  }

  async #generateSummary(result) {
    const failedStep = result.stepResults?.find((s) => !s.passed);
    const prompt = `Write a concise one-paragraph plain-English summary of this test result for a QA report.

Test case: ${result.testCaseId} — "${result.title}"
Outcome: ${result.passed ? 'PASSED' : 'FAILED'}
Steps executed: ${result.stepResults?.length ?? 0}
${failedStep ? `Failed at: ${JSON.stringify(failedStep.step)}` : ''}

Keep it under 3 sentences. Describe what was tested and what happened — no technical jargon.`;

    const { text } = await this.router.complete(prompt, 'test-summary');
    return text.trim();
  }

  async #generateRootCause(result, logs) {
    const failedStep = result.stepResults?.find((s) => !s.passed);
    const logSnippet = logs
      ? `Log analysis:\n${JSON.stringify(logs, null, 2).slice(0, 800)}`
      : 'No log evidence available.';

    const prompt = `You are a QA engineer performing root-cause analysis on a test failure.

Test case: ${result.testCaseId} — "${result.title}"
Failed step: ${JSON.stringify(failedStep?.step ?? {})}
Error: ${failedStep?.error ?? 'unknown'}
Screenshot: ${failedStep?.screenshot ?? 'none'}
${logSnippet}

Identify the most likely root cause. Classify it as one of:
- UI bug (missing element, selector changed, layout regression)
- API failure (bad response, timeout, auth error)
- Data issue (missing test data, wrong state, stale fixture)
- Environment issue (service down, misconfiguration)
- Test script issue (wrong selector, flaky wait, race condition)

Respond in 2-3 sentences: classification, specific reason, recommended fix.`;

    const { text } = await this.router.complete(prompt, 'failure-root-cause');
    return text.trim();
  }

  // ── Report assembly ────────────────────────────────────────────────────────

  #buildReport(enriched, { runId, runUrl, suiteName }) {
    const total = enriched.length;
    const passed = enriched.filter((r) => r.passed).length;
    const failed = total - passed;

    const report = {
      runId,
      runUrl,
      suiteName,
      generatedAt: new Date().toISOString(),
      summary: {
        total,
        passed,
        failed,
        passRate: total > 0 ? `${Math.round((passed / total) * 100)}%` : '0%',
      },
      testCases: enriched.map((r) => {
        const failedStep = r.stepResults?.find((s) => !s.passed);
        return {
          testCaseId: r.testCaseId,
          title: r.title,
          passed: r.passed,
          summary: r.summary,
          ...(r.rootCause ? { rootCause: r.rootCause } : {}),
          steps: {
            total: r.stepResults?.length ?? 0,
            passed: r.stepResults?.filter((s) => s.passed).length ?? 0,
          },
          screenshot: failedStep?.screenshot ?? null,
        };
      }),
    };

    const filename = `report-${Date.now()}.json`;
    const reportPath = join(REPORTS_DIR, filename);
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`[ResultReporter] Report saved: ${reportPath}`);

    this.#printSummary(report);
    return { ...report, reportPath };
  }

  #printSummary(report) {
    console.log('\n' + '─'.repeat(50));
    console.log(`  ${report.suiteName}`);
    console.log(`  ${report.summary.passed}/${report.summary.total} passed  (${report.summary.passRate})`);
    console.log('─'.repeat(50));
    for (const tc of report.testCases) {
      const icon = tc.passed ? '✓' : '✗';
      console.log(`  ${icon}  ${tc.testCaseId}  ${tc.title}`);
      if (!tc.passed && tc.rootCause) {
        console.log(`       Root cause: ${tc.rootCause.split('\n')[0]}`);
      }
    }
    console.log('─'.repeat(50) + '\n');
  }
}
