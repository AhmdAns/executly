import 'dotenv/config';
import { LLMRouter } from './llm/LLMRouter.js';
import { getGeminiUsage } from './llm/usageTracker.js';

const router = new LLMRouter();

console.log('Executly — Phase 2 ready\n');
console.log('Modules:');
console.log('  ✓ LLMRouter         (llm/LLMRouter.js)');
console.log('  ✓ AzureConnector    (azure/AzureConnector.js)');
console.log('  ✓ StepBeautifier    (beautifier/StepBeautifier.js)');
console.log('  ✓ PlaywrightExecutor (executor/PlaywrightExecutor.js)');

console.log('\nTask routing table:');
for (const [task, provider] of Object.entries(router.routingTable)) {
  const resolved = router.resolve(task);
  console.log(`  ${task.padEnd(26)} → ${resolved}`);
}

const limit = parseInt(process.env.GEMINI_DAILY_LIMIT ?? '1400', 10);
console.log(`\nGemini usage today: ${getGeminiUsage()} / ${limit}`);

console.log(`
End-to-end usage (Phases 0–2):

  import { AzureConnector }    from './azure/AzureConnector.js';
  import { StepBeautifier }    from './beautifier/StepBeautifier.js';
  import { PlaywrightExecutor } from './executor/PlaywrightExecutor.js';

  const azure    = new AzureConnector();
  const beautify = new StepBeautifier();
  const executor = new PlaywrightExecutor();

  const workItems = await azure.fetchTestCases(planId, suiteId);
  const testCases = await beautify.beautifyAll(workItems);

  await executor.launch();
  const results = await executor.executeTestCases(testCases);
  await executor.close();

  console.log(JSON.stringify(results, null, 2));
`);
