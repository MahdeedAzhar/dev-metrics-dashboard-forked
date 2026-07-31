import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStoryPoints } from '../../src/parse/storyPoints.js';

test('parses clean integer SP values', () => {
  const result = parseStoryPoints('**Planned SP:** 5\n**Actual SP:** 5');
  assert.equal(result.planned_sp.parsed_numeric, 5);
  assert.equal(result.actual_sp.parsed_numeric, 5);
});

test('parses SP values with extra text around the number', () => {
  const result = parseStoryPoints('**Planned SP:** ~5 SP\n**Actual SP:** about 8, maybe more');
  assert.equal(result.planned_sp.parsed_numeric, 5);
  assert.equal(result.actual_sp.parsed_numeric, 8);
});

test('treats unfilled template placeholder prose as unparseable, not zero', () => {
  const result = parseStoryPoints(
    '**Planned SP:** _Story points estimated in Jira_\n' +
      '**Actual SP:** _Story points representing time actually spent (incl. AI-assisted), fill in manually_',
  );
  assert.equal(result.planned_sp.parsed_numeric, null);
  assert.equal(result.actual_sp.parsed_numeric, null);
  assert.ok(result.planned_sp.raw.includes('Story points'));
});

test('treats non-numeric text like TBD as unparseable', () => {
  const result = parseStoryPoints('**Planned SP:** TBD\n**Actual SP:** TBD');
  assert.equal(result.planned_sp.parsed_numeric, null);
  assert.equal(result.actual_sp.parsed_numeric, null);
});

test('handles missing fields and empty body without throwing', () => {
  const result = parseStoryPoints('no SP fields here at all');
  assert.deepEqual(result.planned_sp, { raw: null, parsed_numeric: null });
  assert.deepEqual(result.actual_sp, { raw: null, parsed_numeric: null });

  const emptyResult = parseStoryPoints(undefined);
  assert.deepEqual(emptyResult.planned_sp, { raw: null, parsed_numeric: null });
});
