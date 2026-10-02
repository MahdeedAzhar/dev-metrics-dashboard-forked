import test from 'node:test';
import assert from 'node:assert/strict';
import { extractTicketId } from '../../src/parse/ticketId.js';

test('prefers the title over the body and supports common conventions', () => {
  assert.deepEqual(extractTicketId('ACME-12: fix', '[ACME-99](x)'), { ticketId: 'ACME-12', source: 'title' });
  assert.deepEqual(extractTicketId('[ACME-12] fix', ''), { ticketId: 'ACME-12', source: 'title' });
  assert.deepEqual(extractTicketId('ACME-12 - fix', ''), { ticketId: 'ACME-12', source: 'title' });
  assert.deepEqual(extractTicketId('feat(ACME-12): fix', ''), { ticketId: 'ACME-12', source: 'title' });
  assert.deepEqual(extractTicketId('fix: ACME-12 something', ''), { ticketId: 'ACME-12', source: 'title' });
});

test('falls back to a leading body link or a Jira: line', () => {
  assert.deepEqual(extractTicketId('fix things', '[ACME-7](https://acme.atlassian.net/browse/ACME-7)\n\ndetails'), {
    ticketId: 'ACME-7',
    source: 'body',
  });
  assert.deepEqual(extractTicketId('fix things', 'Summary\n\nJira: ACME-8'), { ticketId: 'ACME-8', source: 'body' });
  assert.deepEqual(extractTicketId('fix things', 'no key here'), { ticketId: null, source: 'none' });
});

test('ignores keys from other projects when a project key is given', () => {
  assert.deepEqual(extractTicketId('OTHER-1: fix', '[ACME-2](x)', { projectKey: 'ACME' }), {
    ticketId: 'ACME-2',
    source: 'body',
  });
  assert.deepEqual(extractTicketId('OTHER-1: fix', '', { projectKey: 'ACME' }), { ticketId: null, source: 'none' });
});
