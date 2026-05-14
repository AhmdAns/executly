# Executly

Smart test execution tool that fetches test cases from Azure DevOps, beautifies steps with AI, executes them via Playwright, and reports results back — all routed through a cost-aware LLM layer that defaults to Gemini and falls back to Claude.

## Architecture

```
Azure DevOps
    │
    ▼
StepBeautifier ──── GapDetector (pre-flight quality scan)
    │
    ▼
PlaywrightExecutor ── SelectorHealer (auto-fix broken selectors)
    │
    ├── ApiRunner      (HTTP / Postman collections)
    ├── DBRunner       (PostgreSQL / MySQL / MSSQL)
    ├── CronTrigger    (HTTP / Kubernetes / AWS / GCP)
    └── LogChecker     (Datadog / Splunk / ELK)
    │
    ▼
RootCauseAnalyzer
    │
    ▼
ResultReporter ──── Azure Test Runs
    │
    └── reports/report-{timestamp}.json
```

### LLM Routing

All LLM calls go through `LLMRouter` — never directly to a provider. Gemini 1.5 Flash handles high-volume structured tasks; Claude Sonnet handles reasoning and ambiguity. The router falls back to Claude automatically when the Gemini daily quota is reached.

| Task | Provider |
|---|---|
| Step normalization | Gemini |
| JSON extraction | Gemini |
| Plain-English summary | Gemini |
| API request generation | Gemini |
| API response analysis | Gemini |
| DB query (simple) | Gemini |
| Gap detection | Gemini |
| Test summary | Gemini |
| Vague/complex steps | Claude |
| Selector resolution | Claude |
| Selector healing | Claude |
| DB query (complex) | Claude |
| Failure root-cause | Claude |
| Deep root-cause analysis | Claude |
| Log correlation | Claude |

Override routing with `LLM_PREFER=claude` or force a provider with `LLM_FORCE=claude`.

---

## Installation

```bash
npm install
npx playwright install chromium
```

### Optional dependencies

Install only what you need:

```bash
npm install newman          # Postman collection runner
npm install pg              # PostgreSQL
npm install mysql2          # MySQL
npm install mssql           # SQL Server
```

---

## Configuration

Copy `.env` and fill in your keys:

```env
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...

AZURE_DEVOPS_PAT=...
AZURE_ORG_URL=https://dev.azure.com/your-org
AZURE_PROJECT=your-project

LLM_PREFER=gemini          # gemini | claude
LLM_FORCE=none             # none | gemini | claude
GEMINI_DAILY_LIMIT=1400

CLAUDE_MODEL=claude-sonnet-4-6
GEMINI_MODEL=gemini-1.5-flash

# Facilitators
DB_TYPE=postgres           # postgres | mysql | mssql
DB_CONNECTION_STRING=postgresql://user:pass@localhost:5432/db

CRON_ADAPTER=http          # http | k8s | aws | gcp
CRON_HTTP_URL=https://scheduler.internal/trigger

LOG_TOOL=datadog           # datadog | splunk | elk
LOG_TOOL_API_KEY=...
LOG_TOOL_URL=https://api.datadoghq.com
SPLUNK_URL=https://splunk.internal:8088
SPLUNK_HEC_TOKEN=...
```

---

## Usage

### Verify setup

```bash
node index.js
```

Prints the full module list, LLM routing table, and today's Gemini quota usage — no API calls made.

### Full pipeline

```js
import { AzureConnector }     from './azure/AzureConnector.js';
import { StepBeautifier }     from './beautifier/StepBeautifier.js';
import { GapDetector }        from './intelligence/GapDetector.js';
import { PlaywrightExecutor } from './executor/PlaywrightExecutor.js';
import { LogChecker }         from './facilitators/LogChecker.js';
import { RootCauseAnalyzer }  from './intelligence/RootCauseAnalyzer.js';
import { ResultReporter }     from './reporter/ResultReporter.js';

// 1. Fetch and beautify test cases
const workItems = await new AzureConnector().fetchTestCases(planId, suiteId);
const testCases = await new StepBeautifier().beautifyAll(workItems);

// 2. Pre-flight gap scan (before spending time executing)
const { summary, reports } = await new GapDetector().detect(testCases);
const blockers = reports.filter(r => r.gaps.some(g => g.severity === 'critical'));
if (blockers.length) console.warn('Critical gaps — review before running');

// 3. Execute (SelectorHealer is wired in automatically)
const testStart = new Date().toISOString();
const executor  = new PlaywrightExecutor();
await executor.launch();
const results = await executor.executeTestCases(testCases);
await executor.close();

// 4. Collect logs and run deep root-cause analysis on failures
const analyzer   = new RootCauseAnalyzer();
const logChecker = new LogChecker();
const contextMap = {};
for (const r of results.filter(r => !r.passed)) {
  const window = LogChecker.windowFrom(testStart, 300);
  const logs   = await logChecker.check({ query: 'error OR exception', ...window });
  contextMap[r.testCaseId] = { logs };
}
const analyses = await analyzer.analyzeAll(results, contextMap);

// 5. Publish to Azure Test Runs and save report
const logEvidence = Object.fromEntries(
  Object.entries(contextMap).map(([k, v]) => [k, v.logs])
);
const report = await new ResultReporter().report(results, {
  planId,
  suiteName: 'Smoke Suite',
  logEvidence,
});

console.log('Report saved to:', report.reportPath);
console.log('Healed selectors:', executor.healer.report());
```

### Individual modules

```js
// API Runner
const result = await new ApiRunner().run(
  { method: 'POST', url: 'https://api.example.com/orders', assertions: ['status is 201'] },
  testContext
);

// DB Runner
const db = new DBRunner();
await db.connect();
const rows  = await db.queryFromDescription('find all users created today');
const check = await db.assertQuery('SELECT count(*) FROM orders', 'count > 0');
await db.disconnect();

// Cron Trigger
await new CronTrigger().trigger({ body: { job: 'nightly-sync' } });

// Gap Detector (standalone)
const { reports } = await new GapDetector().detect(testCases);

// Selector Healer (standalone)
const healer = new SelectorHealer();
const fixed  = await healer.heal(page, '[data-id="old-btn"]', 'click');
```

---

## Project structure

```
executly/
├── llm/
│   ├── LLMProvider.js       # Abstract base class
│   ├── ClaudeProvider.js    # Anthropic SDK
│   ├── GeminiProvider.js    # Google Generative AI SDK
│   ├── LLMRouter.js         # Routes by task type + quota
│   └── usageTracker.js      # Daily Gemini quota (JSON file)
├── azure/
│   └── AzureConnector.js    # Fetch test cases via PAT
├── beautifier/
│   └── StepBeautifier.js    # Parse XML steps, normalize with LLM
├── executor/
│   └── PlaywrightExecutor.js # Run steps, retry, screenshot on fail
├── facilitators/
│   ├── ApiRunner.js         # HTTP requests + Newman/Postman
│   ├── DBRunner.js          # SQL queries (pg/mysql2/mssql)
│   ├── CronTrigger.js       # Trigger cron jobs (http/k8s/aws/gcp)
│   └── LogChecker.js        # Fetch and analyze logs
├── intelligence/
│   ├── SelectorHealer.js    # Auto-fix broken selectors mid-run
│   ├── RootCauseAnalyzer.js # Deep failure diagnosis
│   └── GapDetector.js       # Pre-execution test quality scan
├── reporter/
│   └── ResultReporter.js    # Push to Azure, save JSON report
├── reports/                 # Generated JSON reports (gitignored)
├── screenshots/             # Failure screenshots (gitignored)
├── .healed-selectors.json   # Cached healed selectors (gitignored)
├── .env                     # Secrets — never committed
└── index.js                 # Entry point / smoke test
```

---

## Runtime files

| File | Purpose |
|---|---|
| `.gemini-usage.json` | Gemini daily quota counter, auto-resets at midnight |
| `.healed-selectors.json` | Cached selector repairs keyed by `url::selector` |
| `reports/report-*.json` | Full test run report with summaries and root causes |
| `screenshots/*.png` | Captured on step failure, referenced in the report |
