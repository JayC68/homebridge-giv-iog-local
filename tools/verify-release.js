'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const json = (file) => JSON.parse(read(file));

const pkg = json('package.json');
const schema = json('config.schema.json');
const index = read('index.js');
const constants = read('lib/evidence-led-constants.js');
const readme = read('README.md');
const changelog = read('CHANGELOG.md');

let ok = true;
function assert(label, condition, detail = '') {
  if (condition) console.log('PASS ' + label);
  else {
    ok = false;
    console.error('FAIL ' + label + (detail ? ' :: ' + detail : ''));
  }
}

const schemaText = JSON.stringify(schema);
const files = Array.isArray(pkg.files) ? pkg.files.join('|') : '';

assert('package name', pkg.name === 'homebridge-giv-iog-local', pkg.name);
assert('package version', pkg.version === '4.0.0-beta.1', pkg.version);
assert('licence', pkg.license === 'GPL-3.0-or-later', pkg.license);
assert('repository points to original package repo', String(pkg.repository && pkg.repository.url || '').includes('JayC68/homebridge-giv-iog-local'));
assert('plugin registration uses package name', index.includes("const PLUGIN_NAME = 'homebridge-giv-iog-local';"));
assert('platform alias retained', schema.pluginAlias === 'GivHomeModbus' && index.includes("const PLATFORM_NAME = 'GivHomeModbus';"));
assert('runtime marker updated', constants.includes('GivHome Modbus 4.0.0-beta.1 loaded') && index.includes("version: '4.0.0-beta.1'"));
assert('Homebridge keywords retained', pkg.keywords.includes('homebridge-plugin') && pkg.keywords.includes('supports-hap'));
assert('GivTCP/MQTT keywords removed', !pkg.keywords.includes('givtcp') && !pkg.keywords.includes('mqtt'));
assert('no install scripts', !pkg.scripts.preinstall && !pkg.scripts.install && !pkg.scripts.postinstall && !pkg.scripts.prepare && !pkg.scripts.prepublish);
assert('minimal package files', files.includes('index.js') && files.includes('lib') && files.includes('docs') && !files.includes('EVIDENCE.md'));
assert('old evidence doc removed', !fs.existsSync(path.join(root, 'EVIDENCE.md')));
assert('README is direct-local and concise', readme.includes('Direct local GivEnergy integration') && readme.includes('GivTCP') && readme.length < 6000);
assert('CHANGELOG has v4 beta', changelog.includes('## 4.0.0-beta.1') && changelog.includes('GPL-3.0-or-later'));
assert('required docs present', ['docs/MIGRATION_V3_TO_V4.md','docs/TROUBLESHOOTING.md','docs/SAFETY.md','docs/ADVANCED_OCTOPUS.md','NOTICE','TRADEMARKS.md','SECURITY.md','SUPPORT.md'].every((file) => fs.existsSync(path.join(root, file))));
assert('Flux observed-power code retained', index.includes('energyBudgetBasis=observed-effective-power-not-HR112-assumption') && index.includes('HR112PowerRatioObeyed') && index.includes('observedBatteryKwh'));
assert('shared export route cleanup retained', index.includes('sharedRouteNeutralised=yes') && index.includes('HR291 clear') && index.includes('HR293 clear'));
assert('Agile safety retained', index.includes('planner-only current-slot-selected') && index.includes('noInverterWrites=yes') && schemaText.includes('plannerOnly'));

const forbiddenTopLevelPrefixes = ['RELEASE_NOTES_', 'QA_', 'BETA'];
const badTopLevel = fs.readdirSync(root).filter((name) => forbiddenTopLevelPrefixes.some((prefix) => name.startsWith(prefix)));
assert('no old top-level release clutter', badTopLevel.length === 0, badTopLevel.join(', '));

if (!ok) {
  console.error('GivHome v4 cleanup verification failed');
  process.exit(1);
}

console.log('GivHome v4 cleanup verification passed');
