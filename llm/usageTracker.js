import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const USAGE_FILE = join(__dirname, '..', '.gemini-usage.json');

function today() {
  return new Date().toISOString().slice(0, 10);
}

function load() {
  try {
    return JSON.parse(readFileSync(USAGE_FILE, 'utf8'));
  } catch {
    return { date: today(), count: 0 };
  }
}

function save(data) {
  writeFileSync(USAGE_FILE, JSON.stringify(data), 'utf8');
}

export function getGeminiUsage() {
  const data = load();
  if (data.date !== today()) return 0;
  return data.count;
}

export function incrementGeminiUsage() {
  const data = load();
  if (data.date !== today()) {
    save({ date: today(), count: 1 });
    return 1;
  }
  data.count += 1;
  save(data);
  return data.count;
}

export function resetGeminiUsage() {
  save({ date: today(), count: 0 });
}
