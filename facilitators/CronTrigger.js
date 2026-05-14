import 'dotenv/config';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ── Adapter implementations ────────────────────────────────────────────────────

async function triggerHttp(config) {
  const { url, method = 'POST', headers = {}, body = {} } = config;
  if (!url) throw new Error('CRON_HTTP_URL or config.url is required for http adapter');

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { triggered: res.ok, status: res.status, response: text };
}

async function triggerK8s(config) {
  const { cronJobName, namespace = 'default' } = config;
  if (!cronJobName) throw new Error('config.cronJobName is required for k8s adapter');

  const jobName = `${cronJobName}-manual-${Date.now()}`;
  const cmd = `kubectl create job ${jobName} --from=cronjob/${cronJobName} -n ${namespace}`;
  const { stdout, stderr } = await execAsync(cmd);
  return { triggered: true, jobName, stdout: stdout.trim(), stderr: stderr.trim() };
}

async function triggerAws(config) {
  // Requires: npm install @aws-sdk/client-eventbridge
  const { EventBridgeClient, PutEventsCommand } = await import('@aws-sdk/client-eventbridge').catch(() => {
    throw new Error('@aws-sdk/client-eventbridge not installed. Run: npm install @aws-sdk/client-eventbridge');
  });
  const { region = 'us-east-1', eventBusName = 'default', source, detailType, detail = {} } = config;
  const client = new EventBridgeClient({ region });
  const result = await client.send(new PutEventsCommand({
    Entries: [{ EventBusName: eventBusName, Source: source, DetailType: detailType, Detail: JSON.stringify(detail) }],
  }));
  return { triggered: result.FailedEntryCount === 0, entries: result.Entries };
}

async function triggerGcp(config) {
  // Requires: npm install @google-cloud/scheduler
  const { CloudSchedulerClient } = await import('@google-cloud/scheduler').catch(() => {
    throw new Error('@google-cloud/scheduler not installed. Run: npm install @google-cloud/scheduler');
  });
  const { projectId, location = 'us-central1', jobName } = config;
  if (!jobName) throw new Error('config.jobName is required for gcp adapter');
  const client = new CloudSchedulerClient();
  const name = `projects/${projectId}/locations/${location}/jobs/${jobName}`;
  const [response] = await client.runJob({ name });
  return { triggered: true, response };
}

// ── Adapter registry ───────────────────────────────────────────────────────────

const ADAPTERS = { http: triggerHttp, k8s: triggerK8s, aws: triggerAws, gcp: triggerGcp };

// ── Main class ─────────────────────────────────────────────────────────────────

export class CronTrigger {
  constructor(config = {}) {
    this.adapter = (config.adapter ?? process.env.CRON_ADAPTER ?? 'http').toLowerCase();
    this.defaultConfig = {
      url: process.env.CRON_HTTP_URL,
      ...config,
    };
  }

  async trigger(overrides = {}) {
    const triggerFn = ADAPTERS[this.adapter];
    if (!triggerFn) {
      throw new Error(`Unknown adapter "${this.adapter}". Supported: ${Object.keys(ADAPTERS).join(', ')}`);
    }

    const config = { ...this.defaultConfig, ...overrides };
    console.log(`[CronTrigger] Triggering via "${this.adapter}" adapter`);

    const result = await triggerFn(config);
    console.log(`[CronTrigger] ${result.triggered ? 'Triggered' : 'Failed'}`);
    return { adapter: this.adapter, timestamp: new Date().toISOString(), ...result };
  }
}
