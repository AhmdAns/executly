import 'dotenv/config';
import { LLMRouter } from './llm/LLMRouter.js';
import { getGeminiUsage } from './llm/usageTracker.js';

const router = new LLMRouter();

console.log('Executly — all phases complete\n');
console.log('Modules:');
console.log('  Phase 0  ✓ LLMRouter          (llm/LLMRouter.js)');
console.log('  Phase 1  ✓ AzureConnector     (azure/AzureConnector.js)');
console.log('           ✓ StepBeautifier     (beautifier/StepBeautifier.js)');
console.log('  Phase 2  ✓ PlaywrightExecutor (executor/PlaywrightExecutor.js)');
console.log('  Phase 3  ✓ ApiRunner          (facilitators/ApiRunner.js)');
console.log('           ✓ DBRunner           (facilitators/DBRunner.js)');
console.log('           ✓ CronTrigger        (facilitators/CronTrigger.js)');
console.log('           ✓ LogChecker         (facilitators/LogChecker.js)');
console.log('  Phase 4  ✓ ResultReporter     (reporter/ResultReporter.js)');
console.log('  Phase 5  ✓ SelectorHealer     (intelligence/SelectorHealer.js)');
console.log('           ✓ RootCauseAnalyzer  (intelligence/RootCauseAnalyzer.js)');
console.log('           ✓ GapDetector        (intelligence/GapDetector.js)');

console.log('\nTask routing table:');
for (const [task, provider] of Object.entries(router.routingTable)) {
  const resolved = router.resolve(task);
  console.log(`  ${task.padEnd(28)} → ${resolved}`);
}

const limit = parseInt(process.env.GEMINI_DAILY_LIMIT ?? '1400', 10);
console.log(`\nGemini usage today: ${getGeminiUsage()} / ${limit}`);

console.log(`
Full pipeline with Intelligence Layer (Phases 0–5):

  import { AzureConnector }     from './azure/AzureConnector.js';
  import { StepBeautifier }     from './beautifier/StepBeautifier.js';
  import { GapDetector }        from './intelligence/GapDetector.js';
  import { PlaywrightExecutor } from './executor/PlaywrightExecutor.js';
  import { LogChecker }         from './facilitators/LogChecker.js';
  import { RootCauseAnalyzer }  from './intelligence/RootCauseAnalyzer.js';
  import { ResultReporter }     from './reporter/ResultReporter.js';

  // 1. Fetch & beautify
  const workItems = await new AzureConnector().fetchTestCases(planId, suiteId);
  const testCases = await new StepBeautifier().beautifyAll(workItems);

  // 2. Pre-flight gap scan
  const { summary, reports } = await new GapDetector().detect(testCases);
  const blockers = reports.filter(r => r.gaps.some(g => g.severity === 'critical'));
  if (blockers.length) console.warn('Critical gaps found — review before running.');

  // 3. Execute (SelectorHealer wired in automatically)
  const testStart = new Date().toISOString();
  const executor  = new PlaywrightExecutor();
  await executor.launch();
  const results = await executor.executeTestCases(testCases);
  await executor.close();

  // 4. Deep root-cause for failures
  const analyzer = new RootCauseAnalyzer();
  const contextMap = {};
  const logChecker = new LogChecker();
  for (const r of results.filter(r => !r.passed)) {
    const window = LogChecker.windowFrom(testStart, 300);
    const logs   = await logChecker.check({ query: 'error OR exception', ...window });
    const failed = r.stepResults?.find(s => !s.passed);
    contextMap[r.testCaseId] = { logs, selectorHealed: failed?.selectorHealed ?? false };
  }
  const analyses = await analyzer.analyzeAll(results, contextMap);

  // 5. Report
  const logEvidence = Object.fromEntries(Object.entries(contextMap).map(([k, v]) => [k, v.logs]));
  const report = await new ResultReporter().report(results, { planId, suiteName: 'Smoke Suite', logEvidence });
  console.log('Report:', report.reportPath);
  console.log('Healed selectors:', executor.healer.report());
`);
