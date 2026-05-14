import 'dotenv/config';

export class AzureConnector {
  constructor() {
    this.orgUrl = (process.env.AZURE_ORG_URL ?? '').replace(/\/$/, '');
    this.project = process.env.AZURE_PROJECT;
    const pat = process.env.AZURE_DEVOPS_PAT ?? '';
    this.authHeader = `Basic ${Buffer.from(`:${pat}`).toString('base64')}`;
  }

  async #get(url) {
    const res = await fetch(url, {
      headers: { Authorization: this.authHeader, Accept: 'application/json' },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Azure DevOps API error ${res.status}: ${body}`);
    }
    return res.json();
  }

  // Returns an array of work-item IDs for test cases in the given plan/suite
  async fetchTestCaseIds(planId, suiteId) {
    const url =
      `${this.orgUrl}/${this.project}/_apis/test/plans/${planId}` +
      `/suites/${suiteId}/testcases?api-version=7.1`;
    const data = await this.#get(url);
    return (data.value ?? []).map((tc) => tc.testCase.id);
  }

  // Fetches a single work item with all fields expanded (includes XML steps)
  async fetchWorkItem(workItemId) {
    const url =
      `${this.orgUrl}/${this.project}/_apis/wit/workitems/${workItemId}` +
      `?$expand=all&api-version=7.1`;
    return this.#get(url);
  }

  // Fetches all test cases for a plan/suite and returns raw work items
  async fetchTestCases(planId, suiteId) {
    const ids = await this.fetchTestCaseIds(planId, suiteId);
    return Promise.all(ids.map((id) => this.fetchWorkItem(id)));
  }
}
