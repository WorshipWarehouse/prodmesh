// What this install is, and what it may do about updating itself.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

const deployment = await import('./deployment.js');

const ENV_KEYS = ['PRODMESH_DEPLOYMENT', 'PRODMESH_CONTAINER', 'PRODMESH_VERSION', 'PRODMESH_COMMIT', 'PRODMESH_COMMIT_SUBJECT'];
afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  deployment.resetForTests();
});

test('a checkout reports itself as git and can self-update', () => {
  // The repo this test runs in — no environment needed.
  assert.equal(deployment.kind(), 'git');
  const capability = deployment.updateCapability();
  assert.equal(capability.supported, true);
  assert.equal(capability.strategy, 'git');
});

test('a container will not self-update, and says what to do instead', () => {
  // The whole point of an image is that its contents came from the build. A
  // container that git-pulls over itself loses that, and loses it silently:
  // the next restart discards the change and the church is back a version.
  process.env.PRODMESH_CONTAINER = '1';
  assert.equal(deployment.kind(), 'container');

  const capability = deployment.updateCapability();
  assert.equal(capability.supported, false);
  assert.equal(capability.strategy, 'container');
  assert.match(capability.reason, /image/i);
});

test('a packaged copy names reinstalling as the path forward', () => {
  process.env.PRODMESH_DEPLOYMENT = 'package';
  const capability = deployment.updateCapability();
  assert.equal(capability.supported, false);
  assert.ok(capability.reason, 'never refuses without saying what to do instead');
});

test('the build stamp wins over git', () => {
  // What a packaged copy has: by the time it runs there is no repository to
  // ask, so the build tells it what it is.
  process.env.PRODMESH_VERSION = '1.2.3';
  process.env.PRODMESH_COMMIT = 'abc1234';
  process.env.PRODMESH_COMMIT_SUBJECT = 'Ship it';
  deployment.resetForTests();

  const version = deployment.getVersion();
  assert.deepEqual(version, {
    version: '1.2.3', commit: 'abc1234', subject: 'Ship it', source: 'build',
  });
});

test('without a stamp, a checkout still reports its real commit', () => {
  const version = deployment.getVersion();
  assert.equal(version.source, 'git');
  assert.match(version.commit, /^[0-9a-f]{7,}$/);
  assert.ok(version.version, 'a version is always reported');
});

test('the version is resolved once, not per request', () => {
  // It used to fork git TWICE per call on an unauthenticated endpoint, which
  // blocked the event loop — every SSE stream and poller — under a flood.
  assert.equal(deployment.getVersion(), deployment.getVersion());
});

test('the log hint matches the deployment', () => {
  process.env.PRODMESH_CONTAINER = '1';
  assert.match(deployment.logHint(), /docker logs/i);
  delete process.env.PRODMESH_CONTAINER;
  assert.match(deployment.logHint(), /install-service/);
});
