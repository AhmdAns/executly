Here's the full consolidated plan ready to copy and send:

---

## Executly — Full Build Plan for Claude

### What Is Executly?
A smart test execution tool that:
1. Fetches test cases from Azure DevOps
2. Beautifies and simplifies them into clean structured steps using AI
3. Executes them via Playwright MCP
4. Supports facilitator tasks: run APIs (Postman/Newman), query DBs, trigger cron jobs, check logs in security/observability tools
5. Reports results back to Azure Test Runs

---

### LLM Strategy
- **Gemini 1.5 Flash (free)** — default for high-volume, structured, repetitive tasks
- **Claude Sonnet** — fallback for complex reasoning, ambiguity resolution, failure analysis
- **LLM Router** — auto-switches based on task complexity and daily Gemini quota (limit: 1,400/day)
- Config-driven: `LLM_PREFER`, `LLM_FORCE` env vars to override routing

---

### Architecture

```
Azure Test Cases → Step Beautifier → LLM Router → Executly Engine → Playwright MCP → Results
                                        ↙ ↘                ↓
                                  Claude  Gemini     [Facilitators]
                                                    API / DB / Cron / Logs
```

---

### Phase 0 — LLM Adapter Layer (Build First)
Build a provider-agnostic LLM interface:
- `LLMProvider` base class with `complete(prompt, options)`
- `ClaudeProvider` — calls `claude-sonnet-4-20250514` via Anthropic API
- `GeminiProvider` — calls `gemini-1.5-flash` via Google API
- `LLMRouter` — routes by task type and quota usage
- Daily usage tracker stored in Redis or JSON file
- Task routing table:

| Task | Model |
|---|---|
| Step normalization | Gemini |
| Vague/complex steps | Claude |
| JSON extraction | Gemini |
| Failure root-cause | Claude |
| Log correlation | Claude |
| Plain-English summary | Gemini |

---

### Phase 1 — Azure Connector + Step Beautifier
- Connect to Azure DevOps REST API using PAT token
- Fetch test cases by Plan ID and Suite ID
- Send raw steps to Gemini for normalization
- Escalate to Claude if steps are vague, incomplete, or missing expected results
- Output structured step JSON:

```json
{
  "testCaseId": "TC-1042",
  "title": "Verify checkout flow",
  "steps": [
    { "action": "navigate", "target": "https://app.com/checkout" },
    { "action": "click", "selector": "[data-testid='checkout-btn']" },
    { "action": "assert", "expected": "Order confirmed" }
  ],
  "prerequisites": ["user is logged in", "cart has 1 item"]
}
```

---

### Phase 2 — Playwright MCP Executor
- Map structured JSON steps to Playwright MCP commands
- Gemini handles straightforward action translation
- Claude handles ambiguous selectors or multi-step reasoning
- Screenshot on failure
- Retry up to 3 times before marking as failed
- Support semantic/aria selectors to reduce flakiness

---

### Phase 3 — Facilitator Modules
Four facilitator modules that assist test execution:

**A. API Runner**
- Trigger via Newman (Postman CLI) or native HTTP
- Gemini generates request body from test case context
- Capture and assert response status and body

**B. DB Query Runner**
- Support PostgreSQL, MySQL, MSSQL
- Gemini writes simple queries
- Claude handles complex joins or assertion queries
- Connection strings managed via env/secrets vault

**C. Cron Job Trigger**
- Config-driven, no LLM needed
- Support Kubernetes CronJobs, REST-based schedulers, cloud schedulers (AWS EventBridge, GCP Cloud Scheduler)
- Plugin/adapter pattern per environment

**D. Log Checker**
- Connect to Splunk / Datadog / ELK via their APIs
- Claude analyzes log patterns (complex reasoning)
- Correlate log timestamps to test execution window
- Flag anomalies and attach log evidence to test result

---

### Phase 4 — Result Reporter
- Push pass/fail results back to Azure Test Runs via API
- Gemini generates plain-English summary per test case
- Claude generates failure root-cause report when tests fail
- Unified report: test result + log evidence + API response in one view

---

### Phase 5 — Intelligence Layer (Future)
- Auto-healing selectors when Playwright fails
- Failure root-cause suggestion (UI bug vs API failure vs data issue)
- Test case gap detection ("these steps have no assertions")

---

### Environment Config

```env
ANTHROPIC_API_KEY=your_claude_key
GEMINI_API_KEY=your_gemini_key
AZURE_DEVOPS_PAT=your_pat_token
AZURE_ORG_URL=https://dev.azure.com/your-org
LLM_PREFER=gemini
LLM_FORCE=none
GEMINI_DAILY_LIMIT=1400
DB_CONNECTION_STRING=your_db_string
POSTMAN_COLLECTION_PATH=./collections
LOG_TOOL=splunk
LOG_TOOL_API_KEY=your_log_key
```

---

### Suggested Project Structure

```
executly/
├── llm/
│   ├── LLMProvider.js
│   ├── ClaudeProvider.js
│   ├── GeminiProvider.js
│   └── LLMRouter.js
├── azure/
│   └── AzureConnector.js
├── beautifier/
│   └── StepBeautifier.js
├── executor/
│   └── PlaywrightExecutor.js
├── facilitators/
│   ├── ApiRunner.js
│   ├── DBRunner.js
│   ├── CronTrigger.js
│   └── LogChecker.js
├── reporter/
│   └── ResultReporter.js
├── config/
│   └── .env
└── index.js
```

---

### Build Order
1. LLM Adapter + Router
2. Azure Connector
3. Step Beautifier
4. Playwright Executor
5. Facilitator Modules (API → DB → Cron → Logs)
6. Result Reporter
7. Intelligence Layer

---

### Key Constraints to Tell Claude
- Use **Node.js**
- LLM calls must go through the router, never directly
- Secrets never hardcoded, always from `.env`
- Each module must be independently testable
- Playwright must use semantic/aria selectors where possible
- All facilitator modules follow the same adapter pattern for swappability

---

That's everything. Paste this into a new Claude conversation and start with **"Build Phase 0 first"** to get the LLM adapter layer scaffolded immediately.