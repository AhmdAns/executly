import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { LLMRouter } from '../llm/LLMRouter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HEALED_FILE = join(__dirname, '..', '.healed-selectors.json');

function loadHealed() {
  if (!existsSync(HEALED_FILE)) return {};
  try { return JSON.parse(readFileSync(HEALED_FILE, 'utf8')); } catch { return {}; }
}

function saveHealed(store) {
  writeFileSync(HEALED_FILE, JSON.stringify(store, null, 2));
}

export class SelectorHealer {
  constructor(router = new LLMRouter()) {
    this.router = router;
    // In-memory cache keyed by "url::selector" so healing is free on repeated runs
    this.cache = loadHealed();
  }

  // Attempt to heal a broken selector. Returns healed selector string or null.
  async heal(page, failedSelector, action) {
    const url = page.url();
    const cacheKey = `${url}::${failedSelector}`;

    if (this.cache[cacheKey]) {
      console.log(`    [SelectorHealer] Cache hit: "${failedSelector}" → "${this.cache[cacheKey].healed}"`);
      return this.cache[cacheKey].healed;
    }

    const html = await this.#pageSnippet(page);
    const prompt = `You are a Playwright automation expert performing selector healing.

A test step failed because this selector no longer matches any element:
  Broken selector: "${failedSelector}"
  Action: ${action}
  Page URL: ${url}

Current page HTML:
${html}

The element this selector used to target may have been renamed, moved, or had its attributes changed.
Find the most likely current equivalent element on the page.

Return ONLY a valid Playwright selector string — nothing else. Use this priority order:
1. role=button[name="..."] or text="..." (most stable)
2. [aria-label="..."]
3. [data-testid="..."]
4. CSS selector (last resort)

If you cannot find a plausible match, return the exact string: NULL`;

    const { text } = await this.router.complete(prompt, 'selector-healing');
    const healed = text.trim().replace(/^["']|["']$/g, '');

    if (!healed || healed === 'NULL') {
      console.warn(`    [SelectorHealer] Could not heal: "${failedSelector}"`);
      return null;
    }

    // Persist so future runs skip the LLM call
    this.cache[cacheKey] = { healed, original: failedSelector, url, healedAt: new Date().toISOString() };
    saveHealed(this.cache);
    return healed;
  }

  // Returns all healed selectors grouped by page URL — useful for updating test cases
  report() {
    const byUrl = {};
    for (const [key, entry] of Object.entries(this.cache)) {
      (byUrl[entry.url] ??= []).push({ original: entry.original, healed: entry.healed, healedAt: entry.healedAt });
    }
    return byUrl;
  }

  async #pageSnippet(page) {
    try {
      const html = await page.content();
      const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
      return body.replace(/\s{2,}/g, ' ').slice(0, 4000);
    } catch {
      return '(page HTML unavailable)';
    }
  }
}
