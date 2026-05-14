import { LLMRouter } from '../llm/LLMRouter.js';

// ── XML helpers ────────────────────────────────────────────────────────────────

function stripHtml(html) {
  return (html ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// Parses the Microsoft.VSTS.TCM.Steps XML field into a plain array
function parseStepsXml(xml) {
  if (!xml) return [];
  const steps = [];
  const stepRe = /<step\s[^>]*type="([^"]+)"[^>]*>([\s\S]*?)<\/step>/g;
  const strRe = /<parameterizedString[^>]*>([\s\S]*?)<\/parameterizedString>/g;

  let stepMatch;
  while ((stepMatch = stepRe.exec(xml)) !== null) {
    const type = stepMatch[1]; // ActionStep | ValidateStep
    const inner = stepMatch[2];
    const strings = [];
    const localRe = new RegExp(strRe.source, strRe.flags);
    let s;
    while ((s = localRe.exec(inner)) !== null) strings.push(stripHtml(s[1]));

    steps.push({ type, action: strings[0] ?? '', expected: strings[1] ?? '' });
  }
  return steps;
}

// ── Vagueness detection ────────────────────────────────────────────────────────

const VAGUE_WORDS = /\b(verify|check|ensure|validate|confirm|make sure)\b/i;

function isVague(rawSteps) {
  if (rawSteps.length === 0) return true;
  const missingExpected = rawSteps.some(
    (s) => s.type === 'ValidateStep' && s.expected.length < 5
  );
  const tooShort = rawSteps.some((s) => s.action.length < 10);
  const onlyVagueWords = rawSteps.every((s) => VAGUE_WORDS.test(s.action));
  return missingExpected || tooShort || onlyVagueWords;
}

// ── Prompts ────────────────────────────────────────────────────────────────────

function buildNormalizationPrompt(title, rawSteps, prerequisites) {
  return `You are a test automation expert. Convert these raw test case steps into a structured JSON object.

Test case title: ${title}
Prerequisites: ${prerequisites.length ? prerequisites.join(', ') : 'none'}

Raw steps:
${rawSteps.map((s, i) => `${i + 1}. Action: ${s.action || '(none)'}${s.expected ? `\n   Expected: ${s.expected}` : ''}`).join('\n')}

Return ONLY valid JSON matching this exact schema — no markdown, no explanation:
{
  "steps": [
    { "action": "navigate|click|type|select|assert|wait|hover|scroll|api-call|db-query", "target": "...", "value": "...", "expected": "..." }
  ],
  "prerequisites": ["..."]
}

Rules:
- Use "navigate" for URL navigation, include full URL in "target"
- Use "click" for button/link clicks, put selector or label in "target"
- Use "type" for text input, put selector in "target" and text in "value"
- Use "assert" for any verification, put what to verify in "expected"
- Omit "value" or "expected" when not applicable
- Extract prerequisites from step context if not explicitly listed`;
}

function buildClarificationPrompt(title, rawSteps, prerequisites) {
  return `You are a test automation expert. These test steps are vague or incomplete. Interpret them intelligently and produce a complete, unambiguous structured JSON object.

Test case title: ${title}
Prerequisites: ${prerequisites.length ? prerequisites.join(', ') : 'none'}

Raw steps (may be vague or missing expected results):
${rawSteps.map((s, i) => `${i + 1}. ${s.action}${s.expected ? ` → expected: ${s.expected}` : ' [no expected result]'}`).join('\n')}

Infer missing details from context and the title. Return ONLY valid JSON — no markdown, no explanation:
{
  "steps": [
    { "action": "navigate|click|type|select|assert|wait|hover|scroll|api-call|db-query", "target": "...", "value": "...", "expected": "..." }
  ],
  "prerequisites": ["..."],
  "clarificationNotes": "brief note on any assumptions made"
}`;
}

// ── JSON extraction ────────────────────────────────────────────────────────────

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`LLM did not return valid JSON:\n${text}`);
  return JSON.parse(match[0]);
}

// ── Main class ─────────────────────────────────────────────────────────────────

export class StepBeautifier {
  constructor(router = new LLMRouter()) {
    this.router = router;
  }

  // Accepts a raw Azure DevOps work item and returns a beautified test case object
  async beautify(workItem) {
    const fields = workItem.fields ?? {};
    const id = workItem.id;
    const title = fields['System.Title'] ?? `Test Case ${id}`;
    const stepsXml = fields['Microsoft.VSTS.TCM.Steps'] ?? '';
    const prereqRaw = fields['Microsoft.VSTS.TCM.LocalDataSource'] ?? '';

    const rawSteps = parseStepsXml(stepsXml);
    const prerequisites = prereqRaw
      ? prereqRaw.split(/[;\n]/).map((s) => s.trim()).filter(Boolean)
      : [];

    const vague = isVague(rawSteps);
    const taskType = vague ? 'vague-steps' : 'step-normalization';
    const prompt = vague
      ? buildClarificationPrompt(title, rawSteps, prerequisites)
      : buildNormalizationPrompt(title, rawSteps, prerequisites);

    console.log(`[StepBeautifier] TC-${id} "${title}" — ${rawSteps.length} steps, vague=${vague}`);

    const { text, provider, model } = await this.router.complete(prompt, taskType);
    const parsed = extractJson(text);

    return {
      testCaseId: `TC-${id}`,
      title,
      steps: parsed.steps ?? [],
      prerequisites: parsed.prerequisites ?? prerequisites,
      ...(parsed.clarificationNotes
        ? { clarificationNotes: parsed.clarificationNotes }
        : {}),
      _meta: { provider, model, vague },
    };
  }

  // Convenience: beautify an array of work items
  async beautifyAll(workItems) {
    return Promise.all(workItems.map((wi) => this.beautify(wi)));
  }
}
