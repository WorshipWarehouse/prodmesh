// Secrets are write-only by design: the API can set them and report WHETHER
// they are set, but no route and no function ever returns a stored value.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PRODMESH_DATA_DIR = mkdtempSync(join(tmpdir(), 'prodmesh-secrets-'));
const secrets = await import('./secrets.js');

test('describeSecrets reports set/length but never the value', () => {
  secrets.setSecrets({ 'planningCenter.appId': 'app-12345', 'planningCenter.secret': 'sh' });
  const described = secrets.describeSecrets().flatMap((g) => g.fields);
  const appId = described.find((s) => s.path === 'planningCenter.appId');
  assert.equal(appId.set, true);
  assert.equal(appId.length, 9);
  // The whole point: no field anywhere carries the secret itself.
  const serialized = JSON.stringify(described);
  assert.ok(!serialized.includes('app-12345'), 'a value leaked into the description');
  for (const entry of described) {
    assert.deepEqual(Object.keys(entry).sort(), ['env', 'label', 'length', 'path', 'secret', 'set', 'value']);
    // Only explicitly non-secret fields (a channel name) ever carry a value.
    if (entry.secret) assert.equal(entry.value, null, `${entry.path} echoed a value`);
  }
});

test('values round-trip into the store for the app to use', () => {
  secrets.setSecrets({ 'slack.botOauthToken': 'xoxb-real-token' });
  assert.equal(secrets.getSecret('slack.botOauthToken'), 'xoxb-real-token');
});

test('an empty string clears a secret', () => {
  secrets.setSecrets({ 'planningCenter.appId': 'temporary' });
  secrets.setSecrets({ 'planningCenter.appId': '' });
  assert.equal(secrets.getSecret('planningCenter.appId'), undefined);
  assert.equal(
    secrets.describeSecrets().flatMap((g) => g.fields).find((s) => s.path === 'planningCenter.appId').set,
    false,
  );
});

test('unknown keys are refused rather than silently stored', () => {
  assert.throws(() => secrets.setSecrets({ 'evil.path': 'x' }), /Unknown secret/);
  // Via JSON, exactly as the route receives it — JSON.parse makes __proto__ a
  // real own property, unlike an object literal where it sets the prototype.
  assert.throws(() => secrets.setSecrets(JSON.parse('{"__proto__":"x"}')), /Unknown secret/);
  assert.throws(() => secrets.setSecrets(JSON.parse('{"constructor.prototype.x":"y"}')), /Unknown secret/);
  assert.throws(() => secrets.setSecrets({ 'planningCenter.appId': 'x'.repeat(501) }), /too long/);
});

test('the file is written owner-only — it was world-readable', () => {
  secrets.setSecrets({ 'planningCenter.secret': 'sensitive' });
  const file = join(process.env.PRODMESH_DATA_DIR, 'secrets.json');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  // And it is real JSON the operator can still read/edit on the box.
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).planningCenter.secret, 'sensitive');
});

test('editing one secret preserves the others', () => {
  secrets.setSecrets({ 'planningCenter.appId': 'keep-me', 'slack.channel': '#tech' });
  secrets.setSecrets({ 'slack.channel': '#booth' });
  assert.equal(secrets.getSecret('planningCenter.appId'), 'keep-me');
  assert.equal(secrets.getSecret('slack.channel'), '#booth');
});

test('an install configured with the old test/prod Slack shape keeps working', async () => {
  // Slack credentials used to live under slack.test.* / slack.prod.* with
  // `slack.use` choosing. Collapsing to one set must not silently orphan an
  // existing install's Slack setup — including the church Producer's.
  const { writeFileSync } = await import('node:fs');
  writeFileSync(
    join(process.env.PRODMESH_DATA_DIR, 'secrets.json'),
    JSON.stringify({
      slack: {
        use: 'prod',
        prod: { botOauthToken: 'xoxb-legacy-prod', channel: '#tech-team' },
        test: { botOauthToken: 'xoxb-legacy-test', channel: '#sandbox' },
      },
    }),
  );
  secrets.reloadSecrets();
  const slack = await import('./integrations/slack.js');
  assert.equal(slack.isConfigured(), true, 'legacy config must still be live');
  assert.equal(slack.activeEnv(), 'prod');

  // …and the new flat key wins once set, without touching the legacy block.
  secrets.setSecrets({ 'slack.botOauthToken': 'xoxb-new', 'slack.channel': '#new' });
  assert.equal(slack.activeEnv(), 'default');
  assert.equal(secrets.getSecret('slack.prod.botOauthToken'), 'xoxb-legacy-prod', 'legacy block preserved');
});
