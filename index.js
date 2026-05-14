import 'dotenv/config';
import { LLMRouter } from './llm/LLMRouter.js';
import { getGeminiUsage } from './llm/usageTracker.js';

const router = new LLMRouter();

console.log('Executly — Phase 3 ready\n');
console.log('Modules:');
console.log('  ✓ LLMRouter          (llm/LLMRouter.js)');
console.log('  ✓ AzureConnector     (azure/AzureConnector.js)');
console.log('  ✓ StepBeautifier     (beautifier/StepBeautifier.js)');
console.log('  ✓ PlaywrightExecutor (executor/PlaywrightExecutor.js)');
console.log('  ✓ ApiRunner          (facilitators/ApiRunner.js)');
console.log('  ✓ DBRunner           (facilitators/DBRunner.js)');
console.log('  ✓ CronTrigger        (facilitators/CronTrigger.js)');
console.log('  ✓ LogChecker         (facilitators/LogChecker.js)');

console.log('\nTask routing table:');
for (const [task, provider] of Object.entries(router.routingTable)) {
  const resolved = router.resolve(task);
  console.log(`  ${task.padEnd(28)} → ${resolved}`);
}

const limit = parseInt(process.env.GEMINI_DAILY_LIMIT ?? '1400', 10);
console.log(`\nGemini usage today: ${getGeminiUsage()} / ${limit}`);

console.log(`
Facilitator usage examples:

  // API Runner — raw HTTP
  const api = new ApiRunner();
  const result = await api.run({ method: 'POST', url: 'https://api.example.com/orders', assertions: ['status is 201'] }, testContext);

  // API Runner — Postman collection (requires: npm install newman)
  await api.runCollection('./collections/smoke.json');

  // DB Runner (requires: npm install pg | mysql2 | mssql)
  const db = new DBRunner();
  await db.connect();
  const rows = await db.queryFromDescription('find all users created today');
  const check = await db.assertQuery('SELECT count(*) FROM orders', 'count should be greater than 0');
  await db.disconnect();

  // Cron Trigger
  const cron = new CronTrigger();
  await cron.trigger({ body: { job: 'nightly-sync' } });  // http adapter

  // Log Checker
  const logs = new LogChecker();
  const window = LogChecker.windowFrom(testStartIso, 300);
  const analysis = await logs.check({ query: 'error OR exception', ...window, testContext: 'checkout flow test' });
`);
