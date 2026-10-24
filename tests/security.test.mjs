import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
let sharpRoot = path.dirname(require.resolve('sharp'));
while (!fs.existsSync(path.join(sharpRoot, 'package.json'))) sharpRoot = path.dirname(sharpRoot);
const project = process.env.XHS_AUDIT_TARGET || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const key = 'sk-xhs-synthetic-secret-XyZQ';
const preload = `
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
const root = process.env.XHS_TEST_ROOT;
os.homedir = () => path.join(root, 'home');
os.tmpdir = () => path.join(root, 'shared-tmp');
process.umask(0o022);
https.request = (options, callback) => {
  const request = new EventEmitter();
  let body = '';
  request.setTimeout = () => request;
  request.destroy = () => {};
  request.write = chunk => { body += chunk; };
  request.end = () => {
    const scan = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const p = path.join(dir, entry.name);
      const stat = fs.statSync(p);
      return [{ path: p, mode: stat.mode & 0o777, directory: entry.isDirectory() }, ...(entry.isDirectory() ? scan(p) : [])];
    });
    fs.writeFileSync(path.join(root, 'request.json'), JSON.stringify({options, body: JSON.parse(body), temporary: scan(os.tmpdir())}));
    process.nextTick(() => {
      const response = new EventEmitter();
      const mode = process.env.XHS_TEST_RESPONSE;
      response.statusCode = mode === 'error' ? 400 : mode === 'server-error' ? 500 : 200;
      callback(response);
      let data;
      if (mode === 'error' || mode === 'server-error') data = 'rejected ' + process.env.XHS_COVER_API_KEY;
      else if (mode === 'invalid-json') data = 'invalid ' + process.env.XHS_COVER_API_KEY;
      else if (mode === 'no-image') data = JSON.stringify({debug: process.env.XHS_COVER_API_KEY});
      else data = JSON.stringify({choices: [{message: {images: [{image_url: {url: 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'photo.png'), 'base64')}}]}}]});
      response.emit('data', Buffer.from(data));
      response.emit('end');
    });
  };
  return request;
};
syncBuiltinESMExports();
`;

async function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-security-test-'));
  try {
    fs.mkdirSync(path.join(root, 'home'));
    fs.mkdirSync(path.join(root, 'shared-tmp'), { mode: 0o755 });
    const repo = path.join(root, 'project');
    fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
    fs.copyFileSync(path.join(project, 'scripts/generate.mjs'), path.join(repo, 'scripts/generate.mjs'));
    fs.cpSync(path.join(project, 'styles'), path.join(repo, 'styles'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'node_modules'));
    fs.symlinkSync(sharpRoot, path.join(repo, 'node_modules/sharp'), 'dir');
    await sharp({create: {width: 8, height: 8, channels: 3, background: '#ffd60a'}}).png().toFile(path.join(root, 'photo.png'));
    fs.writeFileSync(path.join(root, 'preload.mjs'), preload);
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    for (const opener of ['open', 'xdg-open']) {
      fs.writeFileSync(path.join(bin, opener), '#!' + process.execPath + '\n' +
        "require('node:fs').writeFileSync(process.env.XHS_TEST_ROOT + '/opener.json', JSON.stringify(process.argv.slice(2)));\n", {mode: 0o755});
    }
    const execute = (args = [], {response = 'ok', title = 'test'} = {}) => {
      const result = spawnSync(process.execPath, ['--import', path.join(root, 'preload.mjs'), path.join(repo, 'scripts/generate.mjs'),
        '--image', path.join(root, 'photo.png'), '--style', 'hand-drawn-border', '--title', title, '--output-dir', path.join(root, 'output'), ...args], {
        env: {PATH: bin + path.delimiter + path.dirname(process.execPath), XHS_TEST_ROOT: root, XHS_TEST_RESPONSE: response,
          XHS_COVER_API_KEY: key, XHS_COVER_BASE_URL: 'https://example.invalid', XHS_COVER_MODEL: 'test-model'},
        encoding: 'utf8', timeout: 10_000,
      });
      return {...result, log: result.stdout + result.stderr,
        request: fs.existsSync(path.join(root, 'request.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'request.json'))) : null};
    };
    await run({root, repo, execute});
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
}

test('invalid image content is rejected before any API upload', async () => fixture(({root, execute}) => {
  fs.unlinkSync(path.join(root, 'photo.png'));
  fs.writeFileSync(path.join(root, 'secret.json'), JSON.stringify({apiKey: key}));
  fs.symlinkSync(path.join(root, 'secret.json'), path.join(root, 'photo.png'));
  const result = execute();
  assert.notEqual(result.status, 0);
  assert.equal(result.request, null, 'non-image bytes must never enter an API request');
}));

test('temporary photos live inside an owner-only random directory and are removed', async () => fixture(({root, execute}) => {
  const result = execute();
  assert.equal(result.status, 0, result.log);
  const dirs = result.request.temporary.filter(entry => entry.directory);
  assert.equal(dirs.length, 1);
  assert.equal(dirs[0].mode, 0o700);
  assert.ok(result.request.temporary.some(entry => !entry.directory && path.dirname(entry.path) === dirs[0].path));
  assert.deepEqual(fs.readdirSync(path.join(root, 'shared-tmp')), []);
}));

test('temporary photos are also removed when output setup fails', async () => fixture(({root, execute}) => {
  fs.writeFileSync(path.join(root, 'output'), 'not a directory');
  const result = execute();
  assert.notEqual(result.status, 0);
  assert.deepEqual(fs.readdirSync(path.join(root, 'shared-tmp')), []);
}));

test('style display names cannot escape the chosen output directory', async () => fixture(({root, repo, execute}) => {
  const file = path.join(repo, 'styles/hand-drawn-border.json');
  const style = JSON.parse(fs.readFileSync(file));
  style.name = '../escaped';
  fs.writeFileSync(file, JSON.stringify(style));
  const result = execute();
  assert.equal(result.status, 0, result.log);
  assert.equal(fs.readdirSync(root).filter(name => name.startsWith('escaped_')).length, 0);
  assert.equal(fs.readdirSync(path.join(root, 'output')).length, 1);
}));

test('literal shell syntax in user input is not executed', async () => fixture(({root, execute}) => {
  const script = path.join(root, 'project/scripts/generate.mjs');
  const literalOutput = path.join(root, 'output-$(touch SHOULD_NOT_EXIST)');
  const result = spawnSync(process.execPath, ['--import', path.join(root, 'preload.mjs'), script,
    '--image', path.join(root, 'photo.png'), '--style', 'hand-drawn-border', '--title', '$(touch SHOULD_NOT_EXIST)', '--output-dir', literalOutput], {
    cwd: root, env: {PATH: path.join(root, 'bin') + path.delimiter + path.dirname(process.execPath), XHS_TEST_ROOT: root,
      XHS_COVER_API_KEY: key, XHS_COVER_BASE_URL: 'https://example.invalid', XHS_COVER_MODEL: 'test-model'}, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.existsSync(path.join(root, 'SHOULD_NOT_EXIST')), false);
  const opened = JSON.parse(fs.readFileSync(path.join(root, 'opener.json')));
  assert.equal(opened.length, 1);
  assert.equal(path.dirname(opened[0]), literalOutput);
}));

test('connectivity logs contain no API key fragments', async () => fixture(({execute}) => {
  const result = execute(['--test']);
  assert.equal(result.status, 0, result.log);
  assert.equal(result.log.includes(key.slice(0, 8)), false);
  assert.equal(result.log.includes(key.slice(-4)), false);
}));

for (const response of ['error', 'server-error', 'invalid-json', 'no-image']) {
  test('untrusted response content is not copied to logs: ' + response, async () => fixture(({execute}) => {
    const result = execute(['--retries', '0'], {response});
    assert.notEqual(result.status, 0);
    assert.equal(result.log.includes(key), false);
  }));
}

test('query credentials in API endpoint are not logged', async () => fixture(({execute}) => {
  const result = execute(['--test', '--api-endpoint', 'https://example.invalid/v1/chat/completions?key=' + key]);
  assert.equal(result.status, 0, result.log);
  assert.equal(result.log.includes(key), false);
}));

test('plain HTTP endpoints are rejected before an authenticated request', async () => fixture(({execute}) => {
  const result = execute(['--test', '--api-endpoint', 'http://example.invalid/v1/chat/completions']);
  assert.notEqual(result.status, 0);
  assert.equal(result.request, null);
}));


test('configuration inspection does not reveal stored credentials', async () => fixture(({root, execute}) => {
  const dir = path.join(root, 'home/.config/xhs-cover');
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({apiKey: key, baseUrl: 'https://example.invalid'}));
  const result = execute(['--show-config']);
  assert.equal(result.status, 0, result.log);
  assert.equal(result.request, null);
  assert.equal(JSON.parse(result.stdout).apiKeyConfigured, true);
  assert.equal(result.log.includes(key), false);
}));

test('normalization failure still cleans its private temporary directory', async () => fixture(({root, execute}) => {
  fs.writeFileSync(path.join(root, 'photo.png'), 'not an image');
  const result = execute();
  assert.notEqual(result.status, 0);
  assert.equal(result.request, null);
  assert.deepEqual(fs.readdirSync(path.join(root, 'shared-tmp')), []);
}));

for (const title of ['--test', '--api-endpoint', '--api-key']) {
  test('option-like title remains image data: ' + title, async () => fixture(({execute}) => {
    const result = execute([], {title});
    assert.equal(result.status, 0, result.log);
    assert.equal(result.request.options.hostname, 'example.invalid');
    assert.equal(result.request.options.headers.Authorization, 'Bearer ' + key);
    assert.ok(result.request.body.messages[0].content.some(item => item.type === 'text' && item.text.includes(title)));
  }));
}

test('the documented JSON launcher passes hostile-looking text as literal arguments', async () => fixture(({root, repo}) => {
  const skill = fs.readFileSync(path.join(project, 'SKILL.md'), 'utf8');
  const python = skill.match(/python3 - .*?<<'PY'\n([\s\S]*?)\nPY/)[1];
  const title = 'a "quoted" title $(touch SHOULD_NOT_EXIST)';
  const request = path.join(root, 'launch-request.json');
  fs.writeFileSync(request, JSON.stringify({image: path.join(root, 'photo.png'), style: 'hand-drawn-border', title, 'output-dir': path.join(root, 'output')}));
  const result = spawnSync('python3', ['-c', python, repo, request], {
    cwd: root,
    env: {PATH: path.join(root, 'bin') + path.delimiter + process.env.PATH, XHS_TEST_ROOT: root,
      NODE_OPTIONS: '--import=' + path.join(root, 'preload.mjs'), XHS_COVER_API_KEY: key,
      XHS_COVER_BASE_URL: 'https://example.invalid', XHS_COVER_MODEL: 'test-model'},
    encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.existsSync(path.join(root, 'SHOULD_NOT_EXIST')), false);
  const captured = JSON.parse(fs.readFileSync(path.join(root, 'request.json')));
  assert.ok(captured.body.messages[0].content.some(item => item.type === 'text' && item.text.includes(title)));
}));
