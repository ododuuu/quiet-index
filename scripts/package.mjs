import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, unzipSync } from 'fflate';

const project = fileURLToPath(new URL('../', import.meta.url));
const entries = {};
async function add(relative) {
  for (const item of await readdir(path.join(project, relative), { withFileTypes: true })) {
    const child = path.posix.join(relative, item.name);
    if (item.isDirectory()) await add(child);
    else if (item.isFile()) entries[`LocalDocSearch/${child}`] = await readFile(path.join(project, child));
  }
}
for (const folder of ['src', 'test', 'dist', 'docs', 'scripts', 'vendor']) await add(folder);
for (const file of ['README.md', 'docsearch.cmd', 'AGENTS.md', 'package.json', 'package-lock.json', 'tsconfig.json', '.gitignore']) {
  entries[`LocalDocSearch/${file}`] = await readFile(path.join(project, file));
}
const metadata = JSON.parse(await readFile(path.join(project, "package.json"), "utf8"));
const destination = path.join(project, `LocalDocSearch-M27-${metadata.version}.zip`);
const archive = zipSync(entries, { level: 6 });
const unpacked = unzipSync(archive);
for (const [name, contents] of Object.entries(entries)) {
  if (!Buffer.from(unpacked[name]).equals(contents)) throw new Error(`壓縮內容不一致：${name}`);
}
await writeFile(destination, archive);
const sha256 = createHash('sha256').update(archive).digest('hex');
await writeFile(destination + '.sha256', `${sha256}  ${path.basename(destination)}\n`);
console.log(`已建立並核對 ${Object.keys(entries).length} 個檔案：${destination}\nSHA-256：${sha256}`);
