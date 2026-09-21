import test from 'node:test';
import assert from 'node:assert/strict';
import { matchConfiguredRepo } from '../../src/ai/assistant.js';

const REPOS = ['acme/acme-client', 'acme/acme-server', 'acme/mobile-app'];

test('matchConfiguredRepo resolves exact names, substrings and role aliases', () => {
  assert.equal(matchConfiguredRepo('acme/acme-server', REPOS), 'acme/acme-server');
  assert.equal(matchConfiguredRepo('acme-client', REPOS), 'acme/acme-client');
  assert.equal(matchConfiguredRepo('the backend repo', REPOS), 'acme/acme-server');
  assert.equal(matchConfiguredRepo('frontend', REPOS), 'acme/acme-client');
  assert.equal(matchConfiguredRepo('ios', REPOS), 'acme/mobile-app');
  assert.equal(matchConfiguredRepo('data-warehouse', REPOS), null);
  assert.equal(matchConfiguredRepo('backend', []), null);
});
