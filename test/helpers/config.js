import { loadConfig, resetConfigCache } from '../../src/config/index.js';

/** A complete, valid environment for a fictional project. Override per test. */
export const TEST_ENV = Object.freeze({
  PROJECT_NAME: 'Acme Platform',
  JIRA_BASE_URL: 'https://acme.atlassian.net',
  JIRA_EMAIL: 'test@example.com',
  JIRA_API_TOKEN: 'test-token',
  JIRA_PROJECT_KEY: 'ACME',
  JIRA_STORY_POINTS_FIELD: 'customfield_10010',
  JIRA_ACTUAL_POINTS_FIELD: 'customfield_10833',
  JIRA_AI_CONTRIBUTION_FIELD: 'customfield_11729',
  JIRA_AI_CONTRIBUTION_SCALE: 'fraction',
  GITHUB_TOKEN: 'ghp_test',
  GITHUB_REPOS: 'acme/acme-client,acme/acme-server',
});

export function testConfig(overrides = {}) {
  return loadConfig({ ...TEST_ENV, ...overrides });
}

/**
 * Installs TEST_ENV (plus overrides) into process.env for modules that call
 * getConfig() internally, and resets the cache. Returns a restore function.
 */
export function useTestEnv(overrides = {}) {
  const previous = {};
  const env = { ...TEST_ENV, ...overrides };
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined || value === null) delete process.env[key];
    else process.env[key] = value;
  }
  resetConfigCache();
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetConfigCache();
  };
}

/**
 * Replaces globalThis.fetch with a router: `routes` is an array of
 * [matcher, responder] where matcher is a string/RegExp tested against the URL
 * and responder returns { status?, json?, text?, headers? } or a function of
 * (url, init). Records every call in `calls`. Returns a restore function.
 */
export function mockFetch(routes) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [matcher, responder] of routes) {
      const hit = matcher instanceof RegExp ? matcher.test(String(url)) : String(url).includes(matcher);
      if (!hit) continue;
      const spec = typeof responder === 'function' ? await responder(String(url), init) : responder;
      const status = spec.status ?? 200;
      const body = spec.json !== undefined ? JSON.stringify(spec.json) : (spec.text ?? '');
      // Response() refuses a body on 204/304, mirroring real servers.
      const payload = status === 204 || status === 304 ? null : body;
      return new Response(payload, { status, headers: spec.headers ?? { 'content-type': 'application/json' } });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  };
  const restore = () => {
    globalThis.fetch = original;
  };
  restore.calls = calls;
  return restore;
}
