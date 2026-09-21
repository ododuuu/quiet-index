import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { generateDataset } from './dataset.mjs';
const exec = promisify(execFile);
const temporary = await mkdtemp(path.join(os.tmpdir(), 'lds-demo-'));
const root = path.join(temporary, '合成 文件');
const cli = fileURLToPath(new URL('../dist/src/cli.js', import.meta.url));
try {
  const manifest = await generateDataset(root, 12);
  const env = { ...process.env, LOCALDOCSEARCH_DATA_DIR: path.join(temporary, '索引') };
  const run = async args => {
    console.log(`\n> docsearch ${args.join(' ')}`);
    const result = await exec(process.execPath, [cli, ...args], { env });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  };
  await run(['index', root, '--verbose']);
  await run(['search', '中文搜尋', '--type', 'txt,docx', '--limit', '3']);
  await run(['search', '第二頁中文測試', '--type', 'pdf']);
  await writeFile(path.join(root, manifest.documents[0].filename), '修改後的 Demo 更新驗證');
  await run(['index', root]);
  await run(['search', '更新驗證']);
  await run(['index', root]);
  await run(['status']);
} finally { await rm(temporary, { recursive: true, force: true }); }
