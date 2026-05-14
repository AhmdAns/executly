import 'dotenv/config';
import { LLMRouter } from '../llm/LLMRouter.js';

// Maps DB_TYPE env value to the npm package name
const DRIVER_PACKAGES = { postgres: 'pg', mysql: 'mysql2', mssql: 'mssql' };

export class DBRunner {
  constructor(router = new LLMRouter()) {
    this.router = router;
    this.type = (process.env.DB_TYPE ?? 'postgres').toLowerCase();
    this.connectionString = process.env.DB_CONNECTION_STRING;
    this.client = null;
  }

  async connect() {
    const pkg = DRIVER_PACKAGES[this.type];
    if (!pkg) throw new Error(`Unsupported DB_TYPE "${this.type}". Supported: ${Object.keys(DRIVER_PACKAGES).join(', ')}`);

    let driver;
    try {
      driver = await import(pkg);
    } catch {
      throw new Error(`DB driver "${pkg}" not installed. Run: npm install ${pkg}`);
    }

    if (this.type === 'postgres') {
      const { Client } = driver;
      this.client = new Client({ connectionString: this.connectionString });
      await this.client.connect();
    } else if (this.type === 'mysql') {
      this.client = await driver.default.createConnection(this.connectionString);
    } else if (this.type === 'mssql') {
      this.client = await driver.default.connect(this.connectionString);
    }

    console.log(`[DBRunner] Connected to ${this.type}`);
  }

  async disconnect() {
    try {
      if (this.type === 'postgres') await this.client?.end();
      else if (this.type === 'mysql') await this.client?.end();
      else if (this.type === 'mssql') await this.client?.close();
    } finally {
      this.client = null;
    }
  }

  // Execute raw SQL and return rows
  async query(sql, params = []) {
    if (!this.client) throw new Error('Not connected. Call connect() first.');

    if (this.type === 'postgres') {
      const result = await this.client.query(sql, params);
      return result.rows;
    } else if (this.type === 'mysql') {
      const [rows] = await this.client.execute(sql, params);
      return rows;
    } else if (this.type === 'mssql') {
      const result = await this.client.request().query(sql);
      return result.recordset;
    }
  }

  // Generate SQL from a natural language description, then execute it
  async queryFromDescription(description, schema = '') {
    const isComplex = /\b(join|aggregate|group by|subquery|window|cte|with\s+\w+\s+as)\b/i.test(description);
    const taskType = isComplex ? 'db-query-complex' : 'db-query-simple';

    const prompt = `You are a ${this.type} SQL expert.
Write a SQL query for: ${description}
${schema ? `Database schema:\n${schema}` : ''}
Return ONLY the SQL query — no explanation, no markdown fences.`;

    const { text } = await this.router.complete(prompt, taskType);
    const sql = text.trim().replace(/^```(?:sql)?\n?|```$/g, '').trim();

    console.log(`[DBRunner] Generated SQL (${taskType}): ${sql.slice(0, 120)}`);
    return this.query(sql);
  }

  // Run a SQL query and use Claude to evaluate whether the results satisfy an assertion
  async assertQuery(sql, assertion) {
    const rows = await this.query(sql);

    const prompt = `You are a database test validator.
SQL executed: ${sql}
Rows returned (${rows.length} total, showing up to 10):
${JSON.stringify(rows.slice(0, 10), null, 2).slice(0, 1200)}

Assertion to evaluate: ${assertion}

Return ONLY valid JSON — no explanation:
{"passed": true, "reason": "..."}`;

    const { text } = await this.router.complete(prompt, 'db-query-complex');
    const match = text.match(/\{[\s\S]*\}/);
    const evaluation = match ? JSON.parse(match[0]) : { passed: false, reason: 'Evaluation failed' };
    return { ...evaluation, rowCount: rows.length, rows };
  }
}
