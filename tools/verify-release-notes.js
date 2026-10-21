'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const notes = read('RELEASE_NOTES.md');
const changelog = read('CHANGELOG.md');
const readme = read('README.md');
const tagBase = 'https://github.com/KernowekConsulting/homebridge-giv-iog-local/blob/v4.1.0/';

// A GitHub release body needs absolute file links into its tagged source tree.
const githubBody = notes.replace(/\]\(([^)]+)\)/g, (link, target) => {
  if (/^(?:https?:|#)/.test(target)) return link;
  return `](${tagBase}${target})`;
});

if (process.argv.includes('--github-body')) {
  process.stdout.write(githubBody);
} else {
  assert.equal(pkg.version, '4.1.0');
  assert.match(notes, /^# GivHome 4\.1\.0 /);
  assert.match(changelog, /^## 4\.1\.0 /m);
  assert.ok(readme.includes('**4.1.0**'));
  assert.doesNotMatch(notes, /Unreleased|date is pending/);
  const latestChanges = changelog.split('## 4.1.0')[1].split('## 4.0.3-beta.10')[0];
  const internalDiscussion = /our agreement|project owner|explicitly authori[sz]ed|ChatGPT|Codex|assistant|conversation/i;
  assert.doesNotMatch(notes, internalDiscussion);
  assert.doesNotMatch(latestChanges, internalDiscussion);
  assert.match(readme, /\[Release Notes\]\(RELEASE_NOTES\.md\)/);
  assert.match(readme, /\[Full Changelog\]\(CHANGELOG\.md\)/);
  assert.match(notes, /compare\/v4\.0\.2\.\.\.v4\.1\.0/);
  assert.match(notes, /HR242|slot-specific limit/);
  for (const version of ['4.0.0', '4.0.0-beta.3']) {
    assert.ok(changelog.includes(`## ${version} `), `missing history ${version}`);
  }
  for (const file of ['RELEASE_NOTES.md', 'CHANGELOG.md', 'docs']) {
    assert.ok(pkg.files.includes(file), `not included in npm allowlist: ${file}`);
  }
  for (const file of ['RELEASE_NOTES.md', 'CHANGELOG.md', 'README.md', ...fs.readdirSync(path.join(root, 'docs'), { recursive: true }).filter(name => name.endsWith('.md')).map(name => `docs/${name}`)]) {
    for (const match of read(file).matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1];
      if (/^(?:https?:|#)/.test(target)) continue;
      assert.ok(fs.existsSync(path.resolve(root, path.dirname(file), target.split('#')[0])), `broken local link in ${file}: ${target}`);
    }
  }
  console.log('PASS release notes, v4 changelog and links');
}
