// Lists the custom fields on your Jira site so you can fill in
// JIRA_STORY_POINTS_FIELD / JIRA_ACTUAL_POINTS_FIELD / JIRA_AI_CONTRIBUTION_FIELD.
//
//   npm run jira:fields            # likely matches, then all numeric custom fields
//   npm run jira:fields -- --all   # every custom field
//
// Only JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN need to be set.
const baseUrl = (process.env.JIRA_BASE_URL || '').replace(/\/+$/, '');
const email = process.env.JIRA_EMAIL;
const token = process.env.JIRA_API_TOKEN;
const showAll = process.argv.includes('--all');

if (!baseUrl || !email || !token) {
  console.error('Set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN first (see .env.example).');
  process.exit(1);
}

const response = await fetch(`${baseUrl}/rest/api/3/field`, {
  headers: {
    Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`,
    Accept: 'application/json',
  },
});
if (!response.ok) {
  console.error(`Jira API ${response.status}: ${await response.text()}`);
  process.exit(1);
}
const fields = (await response.json()).filter((f) => f.custom);
const numeric = fields.filter((f) => f.schema?.type === 'number');

const guesses = [
  ['JIRA_STORY_POINTS_FIELD', /story\s*point/i],
  ['JIRA_ACTUAL_POINTS_FIELD', /actual/i],
  ['JIRA_AI_CONTRIBUTION_FIELD', /\bai\b|artificial/i],
];

console.log(`Custom fields on ${baseUrl}: ${fields.length} (${numeric.length} numeric)\n`);
console.log('Suggested mappings (verify the name matches what your team actually uses):');
for (const [envVar, pattern] of guesses) {
  const hits = numeric.filter((f) => pattern.test(f.name));
  console.log(`  ${envVar}=${hits.map((f) => `${f.id}  # "${f.name}"`).join(' | ') || '(no numeric field matched)'}`);
}

const list = showAll ? fields : numeric;
console.log(`\n${showAll ? 'All custom fields' : 'Numeric custom fields'}:`);
for (const f of list.sort((a, b) => a.name.localeCompare(b.name))) {
  console.log(`  ${f.id.padEnd(20)} ${f.name}  [${f.schema?.type ?? '?'}]`);
}
