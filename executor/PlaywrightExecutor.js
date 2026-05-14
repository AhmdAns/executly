import 'dotenv/config';
import { EventEmitter } from 'events';
import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { LLMRouter } from '../llm/LLMRouter.js';
import { SelectorHealer } from '../intelligence/SelectorHealer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = join(__dirname, '..', 'screenshots');
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 500;
const SELECTOR_ERROR_RE = /not found|no element|timeout.*waiting|strict mode violation|element is not visible/i;

// Detects explicit Playwright/CSS selectors vs human descriptions
const SELECTOR_RE = /^(\[|#|\.|aria\/|text=|xpath=|role=|:nth-|>>)/;
function looksLikeSelector(s) {
  return SELECTOR_RE.test(s ?? '');
}

// Safe set of LLM-resolvable Playwright methods
const SAFE_METHODS = new Set([
  'click', 'fill', 'selectOption', 'hover', 'focus',
  'waitForSelector', 'waitForURL', 'check', 'uncheck', 'press',
]);

export class PlaywrightExecutor {
  constructor(router = new LLMRouter()) {
    this.router = router;
    this.healer = new SelectorHealer(router);
    this.emitter = new EventEmitter();
    this.browser = null;
    this.page = null;
    if (!existsSync(SCREENSHOTS_DIR)) mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  async launch(options = {}) {
    this.browser = await chromium.launch({ headless: options.headless ?? true });
    const context = await this.browser.newContext();
    this.page = await context.newPage();
    console.log('[PlaywrightExecutor] Browser launched');
  }

  async close() {
    await this.browser?.close();
    this.browser = null;
    this.page = null;
    console.log('[PlaywrightExecutor] Browser closed');
  }

  // Run an array of beautified test cases sequentially (share one browser session)
  async executeTestCases(testCases) {
    const results = [];
    for (const tc of testCases) {
      results.push(await this.executeTestCase(tc));
    }
    return results;
  }

  async executeTestCase(testCase) {
    console.log(`\n[PlaywrightExecutor] ${testCase.testCaseId}: ${testCase.title}`);
    this.emitter.emit('testcase:start', { testCaseId: testCase.testCaseId, title: testCase.title, totalSteps: testCase.steps.length });

    const stepResults = [];

    for (let i = 0; i < testCase.steps.length; i++) {
      const step = testCase.steps[i];
      const result = await this.#runWithRetry(step, testCase.testCaseId, i);
      stepResults.push(result);
      this.emitter.emit('step:result', { testCaseId: testCase.testCaseId, stepIndex: i, ...result });

      if (result.passed) {
        console.log(`  [PASS] step ${i + 1}: ${step.action} ${step.target ?? ''}`);
      } else {
        console.error(`  [FAIL] step ${i + 1}: ${step.action} — ${result.error}`);
        break;
      }
    }

    const passed =
      stepResults.length === testCase.steps.length &&
      stepResults.every((r) => r.passed);

    const tcResult = { testCaseId: testCase.testCaseId, title: testCase.title, passed, stepResults };
    this.emitter.emit('testcase:complete', tcResult);
    return tcResult;
  }

  // ── Internal helpers ─────────────────────────────────────────────────────────

  async #runWithRetry(step, testCaseId, stepIndex, attempt = 1) {
    try {
      await this.#executeStep(step);
      return { step, passed: true, attempt };
    } catch (err) {
      // On first selector failure, attempt healing before the next retry
      const isSelectorError = SELECTOR_ERROR_RE.test(err.message);
      if (attempt === 1 && isSelectorError && step.target) {
        const healed = await this.healer.heal(this.page, step.target, step.action).catch(() => null);
        if (healed && healed !== step.target) {
          console.log(`    [SelectorHealer] "${step.target}" → "${healed}"`);
          step = { ...step, target: healed, _healed: true };
        }
      }

      if (attempt >= MAX_RETRIES) {
        const screenshot = await this.#screenshot(testCaseId, stepIndex);
        return { step, passed: false, error: err.message, screenshot, attempt, selectorHealed: step._healed ?? false };
      }
      console.warn(`    Retry ${attempt}/${MAX_RETRIES}: ${err.message.slice(0, 80)}`);
      await this.page.waitForTimeout(RETRY_BACKOFF_MS * attempt);
      return this.#runWithRetry(step, testCaseId, stepIndex, attempt + 1);
    }
  }

  async #executeStep(step) {
    const { action, target, value, expected } = step;

    switch (action) {
      case 'navigate':
        await this.page.goto(target, { waitUntil: 'domcontentloaded' });
        break;

      case 'click': {
        const sel = await this.#resolveSelector(target, 'click');
        await this.page.click(sel);
        break;
      }

      case 'type': {
        const sel = await this.#resolveSelector(target, 'fill');
        await this.page.fill(sel, value ?? '');
        break;
      }

      case 'select': {
        const sel = await this.#resolveSelector(target, 'selectOption');
        await this.page.selectOption(sel, value ?? '');
        break;
      }

      case 'hover': {
        const sel = await this.#resolveSelector(target, 'hover');
        await this.page.hover(sel);
        break;
      }

      case 'scroll': {
        const sel = await this.#resolveSelector(target, 'scroll');
        await this.page.locator(sel).scrollIntoViewIfNeeded();
        break;
      }

      case 'wait':
        await this.page.waitForTimeout(parseInt(value ?? '1000', 10));
        break;

      case 'assert':
        await this.#handleAssert(step);
        break;

      case 'api-call':
      case 'db-query':
        // Delegated to Phase 3 facilitators — not an executor concern
        console.warn(`[PlaywrightExecutor] "${action}" will be handled by Phase 3 facilitators`);
        break;

      default:
        await this.#executeLLMStep(step);
    }
  }

  async #handleAssert({ target, expected }) {
    const TIMEOUT = 7000;

    if (target && looksLikeSelector(target)) {
      // Assert element exists and optionally contains text
      const locator = this.page.locator(target);
      await locator.waitFor({ timeout: TIMEOUT });
      if (expected) {
        const text = await locator.textContent();
        if (!text?.includes(expected)) {
          throw new Error(`Assert failed: expected "${expected}" in element, got "${text?.slice(0, 100)}"`);
        }
      }
      return;
    }

    // Assert text appears somewhere on the page
    const needle = expected ?? target;
    if (!needle) return;
    const visible = await this.page.waitForFunction(
      (t) => document.body.innerText.includes(t),
      needle,
      { timeout: TIMEOUT },
    ).catch(() => false);

    if (!visible) {
      throw new Error(`Assert failed: "${needle}" not found on page`);
    }
  }

  // Resolves a human label ("Submit button") to a Playwright selector via Claude
  async #resolveSelector(target, action) {
    if (!target) throw new Error(`Step "${action}" has no target`);
    if (looksLikeSelector(target)) return target;

    console.log(`    Resolving selector for "${target}" (${action}) via LLM...`);
    const html = await this.#pageSnippet();
    const prompt = `You are a Playwright automation expert.

Action needed: ${action}
Target description: "${target}"
Current URL: ${this.page.url()}

Relevant page HTML:
${html}

Return ONLY the Playwright selector string — nothing else. Priority order:
1. Semantic: role=button[name="..."] or text="..."
2. Aria: [aria-label="..."]
3. Data attribute: [data-testid="..."]
4. CSS selector (last resort)

Just the selector, no quotes wrapping the whole answer, no explanation.`;

    const { text } = await this.router.complete(prompt, 'selector-resolution');
    return text.trim().replace(/^["']|["']$/g, '');
  }

  // For unknown action types: ask Gemini to map them to a safe Playwright method+args JSON
  async #executeLLMStep(step) {
    const html = await this.#pageSnippet();
    const prompt = `You are a Playwright automation expert.

Test step to perform: ${JSON.stringify(step)}
Current URL: ${this.page.url()}
Relevant page HTML:
${html}

Map this step to ONE Playwright method from this list ONLY:
${[...SAFE_METHODS].join(', ')}

Return ONLY valid JSON — no markdown, no explanation:
{"method": "click", "selector": "...", "value": "..."}

Omit "value" if not needed.`;

    const { text } = await this.router.complete(prompt, 'action-translation');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`LLM returned no JSON for step: ${step.action}`);
    const cmd = JSON.parse(match[0]);

    if (!SAFE_METHODS.has(cmd.method)) {
      throw new Error(`LLM suggested unsafe method: ${cmd.method}`);
    }

    const locator = this.page.locator(cmd.selector);
    switch (cmd.method) {
      case 'click':           await locator.click(); break;
      case 'fill':            await locator.fill(cmd.value ?? ''); break;
      case 'selectOption':    await locator.selectOption(cmd.value ?? ''); break;
      case 'hover':           await locator.hover(); break;
      case 'focus':           await locator.focus(); break;
      case 'check':           await locator.check(); break;
      case 'uncheck':         await locator.uncheck(); break;
      case 'press':           await locator.press(cmd.value ?? ''); break;
      case 'waitForSelector': await this.page.waitForSelector(cmd.selector); break;
      case 'waitForURL':      await this.page.waitForURL(cmd.value ?? cmd.selector); break;
      default:                throw new Error(`Unhandled safe method: ${cmd.method}`);
    }
  }

  async #pageSnippet() {
    try {
      const html = await this.page.content();
      const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
      return body.replace(/\s{2,}/g, ' ').slice(0, 3500);
    } catch {
      return '(page HTML unavailable)';
    }
  }

  async #screenshot(testCaseId, stepIndex) {
    try {
      const name = `${testCaseId}-step${stepIndex + 1}-${Date.now()}.png`;
      const path = join(SCREENSHOTS_DIR, name);
      await this.page.screenshot({ path, fullPage: false });
      console.log(`    Screenshot: ${path}`);
      return path;
    } catch (err) {
      console.warn(`    Screenshot failed: ${err.message}`);
      return null;
    }
  }
}
