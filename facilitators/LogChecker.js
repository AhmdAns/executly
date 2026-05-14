import 'dotenv/config';
import { LLMRouter } from '../llm/LLMRouter.js';

// ── Log tool adapters ──────────────────────────────────────────────────────────

async function fetchSplunk({ query, startTime, endTime }) {
  const url = process.env.SPLUNK_URL;
  const token = process.env.SPLUNK_HEC_TOKEN;
  if (!url || !token) throw new Error('SPLUNK_URL and SPLUNK_HEC_TOKEN must be set');

  const res = await fetch(`${url}/services/search/jobs/export`, {
    method: 'POST',
    headers: {
      Authorization: `Splunk ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      search: `search ${query} earliest=${startTime} latest=${endTime}`,
      output_mode: 'json',
    }),
  });

  const text = await res.text();
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

async function fetchDatadog({ query, startTime, endTime }) {
  const apiKey = process.env.LOG_TOOL_API_KEY;
  const baseUrl = (process.env.LOG_TOOL_URL ?? 'https://api.datadoghq.com').replace(/\/$/, '');
  if (!apiKey) throw new Error('LOG_TOOL_API_KEY must be set for Datadog');

  const res = await fetch(`${baseUrl}/api/v2/logs/events/search`, {
    method: 'POST',
    headers: { 'DD-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filter: { query, from: startTime, to: endTime },
      page: { limit: 100 },
    }),
  });

  const data = await res.json();
  return data.data ?? [];
}

async function fetchElk({ query, startTime, endTime }) {
  const url = (process.env.LOG_TOOL_URL ?? '').replace(/\/$/, '');
  const apiKey = process.env.LOG_TOOL_API_KEY;
  if (!url) throw new Error('LOG_TOOL_URL must be set for ELK');

  const res = await fetch(`${url}/_search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `ApiKey ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      query: {
        bool: {
          must: [
            { query_string: { query } },
            { range: { '@timestamp': { gte: startTime, lte: endTime } } },
          ],
        },
      },
      size: 100,
    }),
  });

  const data = await res.json();
  return data.hits?.hits ?? [];
}

const ADAPTERS = { splunk: fetchSplunk, datadog: fetchDatadog, elk: fetchElk };

// ── Main class ─────────────────────────────────────────────────────────────────

export class LogChecker {
  constructor(router = new LLMRouter()) {
    this.router = router;
    this.tool = (process.env.LOG_TOOL ?? 'datadog').toLowerCase();
  }

  // Fetch logs for a time window and return Claude's analysis
  async check({ query, startTime, endTime, testContext = '' }) {
    const fetchFn = ADAPTERS[this.tool];
    if (!fetchFn) {
      throw new Error(`Unknown LOG_TOOL "${this.tool}". Supported: ${Object.keys(ADAPTERS).join(', ')}`);
    }

    console.log(`[LogChecker] Fetching ${this.tool} logs — query: "${query}"`);
    const logs = await fetchFn({ query, startTime, endTime });
    console.log(`[LogChecker] Retrieved ${logs.length} entries`);

    return this.#analyze(logs, { query, startTime, endTime, testContext });
  }

  // Build a time window from a test start timestamp and duration in seconds
  static windowFrom(startIso, durationSeconds = 300) {
    const start = new Date(startIso);
    const end = new Date(start.getTime() + durationSeconds * 1000);
    return { startTime: start.toISOString(), endTime: end.toISOString() };
  }

  async #analyze(logs, { query, testContext }) {
    if (logs.length === 0) {
      return { verdict: 'clean', anomalies: [], summary: 'No log entries found for this window.', logCount: 0, logs: [] };
    }

    const sample = JSON.stringify(logs.slice(0, 20), null, 2).slice(0, 3000);

    const prompt = `You are an expert log analyst investigating a test execution.

Test context: ${testContext || 'automated test run'}
Log search query: ${query}
Total entries found: ${logs.length}

Sample log entries:
${sample}

Analyze these logs:
1. Identify errors, warnings, and anomalies
2. Distinguish real problems from test-induced noise
3. Note anything that could indicate a root cause for test failure

Return ONLY valid JSON — no explanation:
{
  "verdict": "clean|warnings|errors",
  "anomalies": [{"severity": "error|warning|info", "message": "...", "timestamp": "..."}],
  "evidence": ["key log line 1", "key log line 2"],
  "summary": "concise paragraph"
}`;

    const { text } = await this.router.complete(prompt, 'log-correlation');
    const match = text.match(/\{[\s\S]*\}/);
    const analysis = match
      ? JSON.parse(match[0])
      : { verdict: 'unknown', anomalies: [], evidence: [], summary: 'Log analysis failed.' };

    return { ...analysis, logCount: logs.length, logs: logs.slice(0, 5) };
  }
}
