'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const notes = read('RELEASE_NOTES.md');
const changelog = read('CHANGELOG.md');
const archive = read('docs/CHANGELOG_V3.md');
const readme = read('README.md');
const tagBase = 'https://github.com/JayC68/homebridge-giv-iog-local/blob/v4.0.3-beta.2/';

// A GitHub release body needs absolute file links into its tagged source tree.
const githubBody = notes.replace(/\]\(([^)]+)\)/g, (link, target) => {
  if (/^(?:https?:|#)/.test(target)) return link;
  return `](${tagBase}${target})`;
});

if (process.argv.includes('--github-body')) {
  process.stdout.write(githubBody);
} else {
  assert.equal(pkg.version, '4.0.3-beta.2');
  assert.match(notes, /^# GivHome 4\.0\.3-beta\.2 /);
  assert.match(changelog, /^## 4\.0\.3-beta\.2 /m);
  assert.ok(readme.includes('**4.0.3-beta.2**'));
  assert.doesNotMatch(notes, /Unreleased|date is pending/);
  assert.match(readme, /\[Release Notes\]\(RELEASE_NOTES\.md\)/);
  assert.match(readme, /\[Full Changelog\]\(CHANGELOG\.md\)/);
  assert.match(notes, /compare\/v4\.0\.3-beta\.1\.\.\.v4\.0\.3-beta\.2/);
  assert.match(notes, /HR242|slot-specific limit/);
  for (const version of ['4.0.0', '4.0.0-beta.3', '1.3.1', '1.3.0', '1.2.0']) {
    assert.ok(changelog.includes(`## ${version} `), `missing history ${version}`);
  }
  for (const version of ['3.7.5', '3.7.4', '3.7.1', '3.6.0', '3.4.0']) {
    assert.ok(archive.includes(`## ${version}`), `missing archived history ${version}`);
  }
  for (const file of ['RELEASE_NOTES.md', 'CHANGELOG.md', 'docs']) {
    assert.ok(pkg.files.includes(file), `not included in npm allowlist: ${file}`);
  }
  for (const file of ['RELEASE_NOTES.md', 'CHANGELOG.md', 'README.md']) {
    for (const match of read(file).matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1];
      if (/^(?:https?:|#)/.test(target)) continue;
      assert.ok(fs.existsSync(path.join(root, target)), `broken local link in ${file}: ${target}`);
    }
  }
  assert.equal(read('docs/GITHUB_RELEASE_v4.0.3-beta.2.md'), githubBody, 'GitHub body differs from release notes');
  console.log('PASS release notes, full changelog, archived history, links and GitHub release body');
}
