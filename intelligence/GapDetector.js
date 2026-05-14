import 'dotenv/config';
import { LLMRouter } from '../llm/LLMRouter.js';

const SELECTOR_RE = /^(\[|#|\.|aria\/|text=|xpath=|role=|:nth-|>>)/;
const VAGUE_WORDS = /^\s*(verify|check|ensure|validate|confirm|make sure|test)\s*$/i;
const ACTIONS_NEEDING_TARGET = new Set(['click', 'type', 'select', 'hover', 'scroll', 'assert']);
const ACTIONS_NEEDING_VALUE  = new Set(['type', 'select']);

function heuristicGaps(testCase) {
  const gaps = [];
  const { steps = [], prerequisites = [], testCaseId, title } = testCase;

  if (steps.length === 0) {
    gaps.push({ severity: 'critical', type: 'no-steps', description: 'Test case has no steps at all.' });
    return gaps;
  }

  const hasAssert = steps.some((s) => s.action === 'assert');
  if (!hasAssert) {
    gaps.push({ severity: 'critical', type: 'no-assertions', description: 'No assert steps found — test will always pass regardless of outcome.' });
  }

  if (!prerequisites || prerequisites.length === 0) {
    gaps.push({ severity: 'warning', type: 'missing-prerequisites', description: 'No prerequisites defined — test may fail due to state assumptions.' });
  }

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];

    if (ACTIONS_NEEDING_TARGET.has(s.action) && !s.target) {
      gaps.push({ severity: 'critical', type: 'missing-target', description: `Step ${i + 1} ("${s.action}") has no target selector or description.` });
    }

    if (ACTIONS_NEEDING_VALUE.has(s.action) && !s.value) {
      gaps.push({ severity: 'warning', type: 'missing-value', description: `Step ${i + 1} ("${s.action}") has no value to enter.` });
    }

    if (s.action === 'assert' && !s.expected && !s.target) {
      gaps.push({ severity: 'critical', type: 'empty-assertion', description: `Step ${i + 1} is an assert with no expected value or target.` });
    }

    if (s.target && VAGUE_WORDS.test(s.target)) {
      gaps.push({ severity: 'warning', type: 'vague-target', description: `Step ${i + 1} target is vague: "${s.target}".` });
    }
  }

  // Flag consecutive actions with no assertions between them (long assertion-free blocks)
  let actionsSinceLastAssert = 0;
  for (const s of steps) {
    if (s.action === 'assert') { actionsSinceLastAssert = 0; continue; }
    actionsSinceLastAssert++;
    if (actionsSinceLastAssert >= 5) {
      gaps.push({ severity: 'info', type: 'assertion-gap', description: `${actionsSinceLastAssert} consecutive non-assert steps without a checkpoint.` });
      actionsSinceLastAssert = 0;
    }
  }

  return gaps;
}

export class GapDetector {
  constructor(router = new LLMRouter()) {
    this.router = router;
  }

  // Scan an array of beautified test cases. Returns a gap report for each.
  async detect(testCases) {
    const reports = await Promise.all(testCases.map((tc) => this.detectOne(tc)));
    const totalGaps = reports.reduce((sum, r) => sum + r.gaps.length, 0);
    const critical  = reports.reduce((sum, r) => sum + r.gaps.filter((g) => g.severity === 'critical').length, 0);

    console.log(`[GapDetector] Scanned ${testCases.length} test case(s): ${totalGaps} gap(s) found (${critical} critical)`);
    return {
      summary: { testCases: testCases.length, totalGaps, critical, warnings: totalGaps - critical },
      reports,
    };
  }

  async detectOne(testCase) {
    const heuristic = heuristicGaps(testCase);

    // Only call LLM if the test case has steps (avoids wasting quota on empty cases)
    const llmGaps = testCase.steps?.length
      ? await this.#llmGaps(testCase)
      : [];

    // Merge, deduplicate by type+description
    const seen = new Set(heuristic.map((g) => `${g.type}:${g.description}`));
    const merged = [...heuristic];
    for (const g of llmGaps) {
      const key = `${g.type}:${g.description}`;
      if (!seen.has(key)) { merged.push(g); seen.add(key); }
    }

    merged.sort((a, b) => {
      const order = { critical: 0, warning: 1, info: 2 };
      return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
    });

    if (merged.length > 0) {
      console.log(`  ${testCase.testCaseId}: ${merged.length} gap(s) — ${merged.filter(g => g.severity === 'critical').length} critical`);
    }

    return { testCaseId: testCase.testCaseId, title: testCase.title, gaps: merged };
  }

  async #llmGaps(testCase) {
    const prompt = `You are a QA expert reviewing a test case for completeness and quality.

Test case: ${testCase.testCaseId} — "${testCase.title}"
Prerequisites: ${testCase.prerequisites?.join(', ') || 'none'}

Steps:
${testCase.steps.map((s, i) => `${i + 1}. ${JSON.stringify(s)}`).join('\n')}

Identify gaps that a heuristic check might miss, such as:
- Steps that assume implicit state not covered by prerequisites
- Assertions that are too broad to be meaningful
- Missing cleanup/teardown steps that leave state dirty
- Missing boundary conditions or edge cases
- Steps likely to be flaky due to timing issues

Return ONLY a valid JSON array. Return an empty array [] if no gaps found:
[{"severity": "critical|warning|info", "type": "string", "description": "specific gap description"}]`;

    const { text } = await this.router.complete(prompt, 'gap-detection');
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try { return JSON.parse(match[0]); } catch { return []; }
  }
}
