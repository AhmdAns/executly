import 'dotenv/config';
import { LLMRouter } from './llm/LLMRouter.js';
import { getGeminiUsage } from './llm/usageTracker.js';

const router = new LLMRouter();

console.log('Executly — Phase 4 ready (all phases complete)\n');
console.log('Modules:');
console.log('  ✓ LLMRouter          (llm/LLMRouter.js)');
console.log('  ✓ AzureConnector     (azure/AzureConnector.js)');
console.log('  ✓ StepBeautifier     (beautifier/StepBeautifier.js)');
console.log('  ✓ PlaywrightExecutor (executor/PlaywrightExecutor.js)');
console.log('  ✓ ApiRunner          (facilitators/ApiRunner.js)');
console.log('  ✓ DBRunner           (facilitators/DBRunner.js)');
console.log('  ✓ CronTrigger        (facilitators/CronTrigger.js)');
console.log('  ✓ LogChecker         (facilitators/LogChecker.js)');
console.log('  ✓ ResultReporter     (reporter/ResultReporter.js)');

console.log('\nTask routing table:');
for (const [task, provider] of Object.entries(router.routingTable)) {
  const resolved = router.resolve(task);
  console.log(`  ${task.padEnd(28)} → ${resolved}`);
}

const limit = parseInt(process.env.GEMINI_DAILY_LIMIT ?? '1400', 10);
console.log(`\nGemini usage today: ${getGeminiUsage()} / ${limit}`);

console.log(`
Full end-to-end pipeline (Phases 0–4):

  import { AzureConnector }     from './azure/AzureConnector.js';
  import { StepBeautifier }     from './beautifier/StepBeautifier.js';
  import { PlaywrightExecutor } from './executor/PlaywrightExecutor.js';
  import { LogChecker }         from './facilitators/LogChecker.js';
  import { ResultReporter }     from './reporter/ResultReporter.js';

  const azure    = new AzureConnector();
  const beautify = new StepBeautifier();
  const executor = new PlaywrightExecutor();
  const logs     = new LogChecker();
  const reporter = new ResultReporter();

  // 1. Fetch & beautify test cases
  const workItems = await azure.fetchTestCases(planId, suiteId);
  const testCases = await beautify.beautifyAll(workItems);

  // 2. Execute
  const testStart = new Date().toISOString();
  await executor.launch();
  const results = await executor.executeTestCases(testCases);
  await executor.close();

  // 3. Collect log evidence for failures
  const logEvidence = {};
  for (const r of results.filter(r => !r.passed)) {
    const window = LogChecker.windowFrom(testStart, 300);
    logEvidence[r.testCaseId] = await logs.check({ query: 'error OR exception', ...window });
  }

  // 4. Report — pushes to Azure, generates summaries, saves report JSON
  const report = await reporter.report(results, { planId, suiteName: 'Smoke Suite', logEvidence });
  console.log('Report saved to:', report.reportPath);
`);
