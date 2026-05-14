import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { AzureConnector } from './azure/AzureConnector.js';
import { StepBeautifier } from './beautifier/StepBeautifier.js';
import { GapDetector } from './intelligence/GapDetector.js';
import { PlaywrightExecutor } from './executor/PlaywrightExecutor.js';
import { ResultReporter } from './reporter/ResultReporter.js';
import { LogChecker } from './facilitators/LogChecker.js';
import { RootCauseAnalyzer } from './intelligence/RootCauseAnalyzer.js';
import { LLMRouter } from './llm/LLMRouter.js';
import { getGeminiUsage } from './llm/usageTracker.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SETTINGS_FILE = join(__dirname, 'settings.json');
const REPORTS_DIR = join(__dirname, 'reports');

const app = express();
app.use(cors());
app.use(express.json());

// ── In-memory run store ────────────────────────────────────────────────────────

const runs = new Map(); // runId → run object

function makeRun(id, meta) {
  return { id, status: 'pending', startedAt: new Date().toISOString(), sseClients: new Set(), meta, testCases: [], results: [], summary: null, error: null };
}

function emit(runId, event) {
  const run = runs.get(runId);
  if (!run) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of run.sseClients) client.write(data);
}

function closeSSE(runId) {
  const run = runs.get(runId);
  if (!run) return;
  for (const client of run.sseClients) client.end();
  run.sseClients.clear();
}

// ── Settings helpers ───────────────────────────────────────────────────────────

const SETTING_KEYS = [
  'ANTHROPIC_API_KEY', 'GEMINI_API_KEY',
  'AZURE_DEVOPS_PAT', 'AZURE_ORG_URL', 'AZURE_PROJECT',
  'LLM_PREFER', 'LLM_FORCE', 'GEMINI_DAILY_LIMIT', 'CLAUDE_MODEL', 'GEMINI_MODEL',
  'DB_TYPE', 'DB_CONNECTION_STRING',
  'CRON_ADAPTER', 'CRON_HTTP_URL',
  'LOG_TOOL', 'LOG_TOOL_API_KEY', 'LOG_TOOL_URL',
  'SPLUNK_URL', 'SPLUNK_HEC_TOKEN',
];

function loadSettings() {
  const saved = existsSync(SETTINGS_FILE) ? JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')) : {};
  const current = {};
  for (const key of SETTING_KEYS) {
    current[key] = saved[key] ?? process.env[key] ?? '';
  }
  return current;
}

function saveSettings(data) {
  const filtered = {};
  for (const key of SETTING_KEYS) {
    if (data[key] !== undefined) {
      filtered[key] = data[key];
      process.env[key] = data[key]; // apply immediately
    }
  }
  writeFileSync(SETTINGS_FILE, JSON.stringify(filtered, null, 2));
}

// ── Run execution ──────────────────────────────────────────────────────────────

async function executeRun(runId) {
  const run = runs.get(runId);
  const { planId, suiteId, suiteName } = run.meta;

  try {
    run.status = 'fetching';
    emit(runId, { type: 'status', message: 'Fetching test cases from Azure DevOps...' });

    const azure = new AzureConnector();
    const workItems = await azure.fetchTestCases(planId, suiteId);

    run.status = 'beautifying';
    emit(runId, { type: 'status', message: `Beautifying ${workItems.length} test case(s)...` });

    const beautifier = new StepBeautifier();
    const testCases = await beautifier.beautifyAll(workItems);
    run.testCases = testCases;

    emit(runId, { type: 'run:start', total: testCases.length, testCases });

    run.status = 'running';
    const executor = new PlaywrightExecutor();

    executor.emitter.on('testcase:start', (d) => emit(runId, { type: 'testcase:start', ...d }));
    executor.emitter.on('step:result',    (d) => emit(runId, { type: 'step:result', ...d }));
    executor.emitter.on('testcase:complete', (d) => emit(runId, { type: 'testcase:complete', ...d }));

    const testStart = new Date().toISOString();
    await executor.launch();
    const results = await executor.executeTestCases(testCases);
    await executor.close();

    run.status = 'reporting';
    emit(runId, { type: 'status', message: 'Generating report...' });

    // Collect log evidence for failures
    const logEvidence = {};
    const logChecker = new LogChecker();
    for (const r of results.filter((r) => !r.passed)) {
      try {
        const window = LogChecker.windowFrom(testStart, 300);
        logEvidence[r.testCaseId] = await logChecker.check({ query: 'error OR exception', ...window });
      } catch { /* log tool not configured — skip */ }
    }

    const reporter = new ResultReporter();
    const report = await reporter.report(results, { planId, suiteName: suiteName || 'Executly Run', logEvidence });

    run.status = 'complete';
    run.results = results;
    run.summary = report.summary;
    run.reportPath = report.reportPath;
    run.reportId = report.reportPath.split(/[\\/]/).pop().replace('.json', '');

    emit(runId, { type: 'run:complete', summary: report.summary, reportId: run.reportId });

  } catch (err) {
    run.status = 'error';
    run.error = err.message;
    console.error(`[Server] Run ${runId} failed:`, err);
    emit(runId, { type: 'error', message: err.message });
  } finally {
    closeSSE(runId);
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────────

app.get('/api/health', (_, res) => {
  res.json({ ok: true, geminiUsage: getGeminiUsage(), uptime: process.uptime() });
});

// Settings
app.get('/api/settings', (_, res) => res.json(loadSettings()));
app.post('/api/settings', (req, res) => {
  saveSettings(req.body);
  res.json({ ok: true });
});

// Azure — preview test cases
app.get('/api/azure/testcases', async (req, res) => {
  const { planId, suiteId } = req.query;
  if (!planId || !suiteId) return res.status(400).json({ error: 'planId and suiteId are required' });
  try {
    const azure = new AzureConnector();
    const workItems = await azure.fetchTestCases(planId, suiteId);
    const beautifier = new StepBeautifier();
    const testCases = await beautifier.beautifyAll(workItems);
    res.json({ testCases });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Azure — gap detection preview
app.get('/api/azure/gaps', async (req, res) => {
  const { planId, suiteId } = req.query;
  if (!planId || !suiteId) return res.status(400).json({ error: 'planId and suiteId are required' });
  try {
    const azure = new AzureConnector();
    const workItems = await azure.fetchTestCases(planId, suiteId);
    const beautifier = new StepBeautifier();
    const testCases = await beautifier.beautifyAll(workItems);
    const detector = new GapDetector();
    const gapReport = await detector.detect(testCases);
    res.json(gapReport);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Runs — list
app.get('/api/runs', (_, res) => {
  const list = [...runs.values()].map(({ id, status, startedAt, meta, summary, error, reportId }) =>
    ({ id, status, startedAt, meta, summary, error, reportId })
  );
  res.json(list.reverse());
});

// Runs — create
app.post('/api/runs', (req, res) => {
  const { planId, suiteId, suiteName } = req.body;
  if (!planId || !suiteId) return res.status(400).json({ error: 'planId and suiteId are required' });

  const runId = crypto.randomUUID();
  runs.set(runId, makeRun(runId, { planId, suiteId, suiteName }));

  executeRun(runId); // fire-and-forget

  res.status(201).json({ runId });
});

// Runs — get single
app.get('/api/runs/:id', (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  const { sseClients, ...safe } = run;
  res.json(safe);
});

// Runs — SSE stream
app.get('/api/runs/:id/stream', (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send current status immediately so late-joiners catch up
  res.write(`data: ${JSON.stringify({ type: 'status', message: run.status })}\n\n`);

  if (run.status === 'complete' || run.status === 'error') {
    if (run.status === 'complete') {
      res.write(`data: ${JSON.stringify({ type: 'run:complete', summary: run.summary, reportId: run.reportId })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', message: run.error })}\n\n`);
    }
    return res.end();
  }

  run.sseClients.add(res);
  req.on('close', () => run.sseClients.delete(res));
});

// Reports — list
app.get('/api/reports', (_, res) => {
  if (!existsSync(REPORTS_DIR)) return res.json([]);
  const files = readdirSync(REPORTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();
  const reports = files.map((f) => {
    try {
      const data = JSON.parse(readFileSync(join(REPORTS_DIR, f), 'utf8'));
      return { id: f.replace('.json', ''), suiteName: data.suiteName, generatedAt: data.generatedAt, summary: data.summary };
    } catch { return null; }
  }).filter(Boolean);
  res.json(reports);
});

// Reports — single
app.get('/api/reports/:id', (req, res) => {
  const path = join(REPORTS_DIR, `${req.params.id}.json`);
  if (!existsSync(path)) return res.status(404).json({ error: 'Report not found' });
  try {
    res.json(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    res.status(500).json({ error: 'Failed to read report' });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(`[Executly Server] http://localhost:${PORT}`));
