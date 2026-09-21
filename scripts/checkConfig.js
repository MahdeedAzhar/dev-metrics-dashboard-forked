// Validates .env and verifies credentials against Jira and GitHub without
// generating a dashboard. Run this first when onboarding a new project:
//
//   npm run check
//
// Exit code 1 on any problem so it can gate CI/deploys.
import { loadConfig, ConfigError } from '../src/config/index.js';
import { fetchCurrentUser as jiraUser } from '../src/fetch/jiraClient.js';
import { fetchProjectVersions } from '../src/fetch/jiraVersions.js';
import { jiraRequest } from '../src/fetch/jiraClient.js';
import { fetchCurrentUser as githubUser, fetchRepository } from '../src/fetch/github.js';

const results = [];
function ok(label, detail = '') {
  results.push({ ok: true, label, detail });
}
function fail(label, detail = '') {
  results.push({ ok: false, label, detail });
}

async function main() {
  let config;
  try {
    config = loadConfig(process.env);
    ok('Configuration', `project ${config.project.key} (${config.project.name})`);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  // --- Jira
  try {
    const me = await jiraUser(config);
    ok('Jira credentials', `${me.displayName} <${me.emailAddress ?? config.jira.email}>`);
  } catch (error) {
    fail('Jira credentials', error.message);
  }
  try {
    const project = await jiraRequest(`/rest/api/3/project/${encodeURIComponent(config.jira.projectKey)}`, {
      action: 'fetching project',
      config,
    });
    ok('Jira project', `${project.key} — ${project.name}`);
  } catch (error) {
    fail('Jira project', error.message);
  }
  try {
    const versions = await fetchProjectVersions(config);
    const unreleased = versions.filter((v) => !v.released && !v.archived).map((v) => v.name);
    ok('Jira versions', `${versions.length} total, unreleased: ${unreleased.join(', ') || '(none)'}`);
  } catch (error) {
    fail('Jira versions', error.message);
  }
  try {
    const fields = await jiraRequest('/rest/api/3/field', { action: 'fetching fields', config });
    const byId = new Map(fields.map((f) => [f.id, f]));
    for (const [label, id] of [
      ['Story points field', config.jira.fields.storyPoints],
      ['Actual points field', config.jira.fields.actualPoints],
      ['AI contribution field', config.jira.fields.aiContribution],
    ]) {
      if (!id) {
        ok(label, 'not configured (feature disabled)');
        continue;
      }
      const field = byId.get(id);
      if (field) ok(label, `${id} = "${field.name}" (${field.schema?.type ?? '?'})`);
      else fail(label, `${id} does not exist on this Jira site. Run npm run jira:fields.`);
    }
  } catch (error) {
    fail('Jira fields', error.message);
  }

  // --- GitHub
  if (config.features.github) {
    try {
      const me = await githubUser(config);
      ok('GitHub credentials', `@${me.login}`);
    } catch (error) {
      fail('GitHub credentials', error.message);
    }
    for (const repo of config.github.repos) {
      try {
        const info = await fetchRepository(repo, config);
        const branchNote = config.github.baseBranch ? ` (filtering PRs to base=${config.github.baseBranch})` : '';
        ok(
          `GitHub repo ${repo}`,
          `default branch ${info.default_branch}, ${info.private ? 'private' : 'public'}${branchNote}`,
        );
      } catch (error) {
        fail(`GitHub repo ${repo}`, error.message);
      }
    }
  } else {
    ok('GitHub', 'not configured — PR evidence and review metrics disabled');
  }

  ok(
    'Assistant',
    config.features.assistant
      ? `enabled (${config.assistant.model} @ ${config.assistant.baseUrl})`
      : 'disabled (no AI_API_KEY)',
  );
  ok('Jira editing', config.features.jiraEditing ? 'enabled' : 'disabled');
  ok('Review logging', config.features.reviewLogging ? 'enabled' : 'disabled');

  for (const r of results) console.log(`${r.ok ? '✔' : '✖'} ${r.label}${r.detail ? ` — ${r.detail}` : ''}`);
  if (results.some((r) => !r.ok)) {
    console.error('\nSome checks failed. See docs/TROUBLESHOOTING.md.');
    process.exitCode = 1;
  } else {
    console.log('\nAll checks passed. Run `npm run dev` to start the dashboard.');
  }
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
