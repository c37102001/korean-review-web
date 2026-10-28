import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { image, snapshotEnvironment } = JSON.parse(readFileSync(new URL('../tests/visual/environment.json', import.meta.url), 'utf8'));
const { version } = JSON.parse(readFileSync(new URL('../node_modules/@playwright/test/package.json', import.meta.url), 'utf8'));
const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
if (!image.includes(`:v${version}-`) || !workflow.includes(`image: ${image}`)) {
  throw new Error('Playwright package, tests/visual/environment.json and CI container image must use the same version and image.');
}
const args = process.argv.slice(2);
const insideContainer = process.env.VISUAL_TEST_CONTAINER === '1';
const command = insideContainer ? process.execPath : 'docker';
const commandArgs = insideContainer
  ? ['node_modules/@playwright/test/cli.js', 'test', ...args]
  : ['run', '--rm', '--init', '--ipc=host',
    '--user', `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
    '--mount', `type=bind,source=${process.cwd()},target=/workspace`,
    '--workdir', '/workspace',
    '--env', 'npm_config_cache=/tmp/korean-review-npm-cache',
    '--env', 'XDG_CACHE_HOME=/tmp/korean-review-cache',
    '--env', 'VISUAL_TEST_CONTAINER=1',
    '--env', `VISUAL_SNAPSHOT_ENV=${snapshotEnvironment}`,
    image, 'node', 'scripts/run_visual_tests.mjs', ...args];
const result = spawnSync(command, commandArgs, {
  stdio: 'inherit',
  env: { ...process.env, VISUAL_SNAPSHOT_ENV: snapshotEnvironment },
});
if (result.error) {
  process.stderr.write(`Cannot start visual tests: ${result.error.message}. Run with Docker, as in CI.\n`);
}
process.exit(result.status ?? 1);
