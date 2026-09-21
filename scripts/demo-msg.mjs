import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeMsg, wrapRtf } from '../dist/test/fixtures/msg.js';

const cli = fileURLToPath(new URL('../dist/src/cli.js', import.meta.url));
const directory = await mkdtemp(path.join(os.tmpdir(), 'lds-msg-demo-'));
const root = path.join(directory, '合成 郵件');
const env = { ...process.env, LOCALDOCSEARCH_DATA_DIR: path.join(directory, '索引') };
function run(...args) {
  console.log(`\n> docsearch ${args.join(' ')}`);
  const result = spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  console.log(result.stdout.trim());
  return result.stdout;
}
try {
  await mkdir(root);
  await writeFile(path.join(root, '採購.msg'), makeMsg({ subject: '合成採購決議', body: '純文字驗證詞', sender: '合成窗口', senderSmtp: 'buyer@example.invalid', recipients: [{ name: '合成承辦', address: 'review@example.invalid', type: 2 }] }));
  await writeFile(path.join(root, '網頁.msg'), makeMsg({ html: '<h1>合成網頁</h1><p>網頁驗證詞</p><a href="https://example.invalid/msg-demo-link">文件連結</a>', attachments: true }));
  await writeFile(path.join(root, 'RTF.msg'), makeMsg({ rtf: wrapRtf(String.raw`{\rtf1\ansi\uc1 \u20013?\u25991? RTF-demo-key}`, true) }));
  await writeFile(path.join(root, 'Big5.msg'), makeMsg({ ansiCodepage: 950, subject: '傳統編碼', body: '繁體驗證詞' }));
  assert.match(run('index', root), /indexed=4/);
  assert.match(run('search', '合成採購決議', '--type', 'msg'), /郵件主旨/);
  assert.match(run('search', 'buyer@example.invalid', '--type', 'msg'), /郵件寄件者/);
  assert.match(run('search', 'review@example.invalid', '--type', 'msg'), /郵件副本/);
  assert.match(run('search', 'msg-demo-link', '--type', 'msg'), /郵件正文（HTML）/);
  assert.match(run('search', '中文 RTF-demo-key', '--type', 'msg'), /郵件正文（RTF）/);
  assert.match(run('search', '繁體驗證詞', '--type', 'msg'), /Big5.msg/);
  assert.match(run('index', root), /解析器呼叫 0 次/);
  await writeFile(path.join(root, '採購.msg'), makeMsg({ body: '修改後驗證詞' }));
  assert.match(run('index', root), /解析器呼叫 1 次/);
  assert.match(run('search', '修改後驗證詞', '--type', 'msg'), /採購.msg/);
  run('status');
  console.log('\nMSG Demo 核對通過；合成資料及索引將清除。');
} finally {
  await rm(directory, { recursive: true, force: true });
}
