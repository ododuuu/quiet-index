import { mkdir, readFile, writeFile, utimes } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';

export const datasetVersion = 'm5-synthetic-v1';
export const seed = 20260916;
export const queries = [
  { query: '合成' }, { query: 'report' }, { query: '中文搜尋' }, { query: 'budget' },
  { query: '標題-0' }, { query: '標題-3' }, { query: 'group0' }, { query: 'group7' },
  { query: 'token-0' }, { query: 'token-9' }, { query: 'First page searchable text' },
  { query: '第二頁中文測試' }, { query: 'definitely-absent-93821' },
  { query: '合成', types: 'pdf' }, { query: 'report', types: 'docx,pptx' },
  { query: '中文搜尋', types: 'txt,md' }, { query: 'budget', types: 'xlsx' },
  { query: '標題', types: 'md,docx' }, { query: 'report', types: 'txt' },
  { query: '合成-00000' },
];

function office(parts) {
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name, value]) => [name,
    [strToU8(value), { mtime: new Date(2020, 0, 1) }]])), { level: 6 });
}

export async function generateDataset(directory, count = 1000) {
  if (!Number.isSafeInteger(count) || count < 6) throw new Error('合成文件數必須至少 6。');
  await mkdir(directory, { recursive: true });
  const pdf = await readFile(new URL('../test/fixtures/text-layer.pdf', import.meta.url));
  let state = seed;
  const formats = ['txt', 'md', 'docx', 'pptx', 'xlsx', 'pdf'];
  const documents = [];
  for (let i = 0; i < count; i++) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    const group = state % 10;
    const ext = formats[i % formats.length];
    const filename = `合成-${String(i).padStart(5, '0')}-group${group}.${ext}`;
    const heading = `標題-${group}`;
    const line = `合成資料 report 中文搜尋 budget token-${group} 編號${i}。`;
    const body = Array.from({ length: 30 }, (_, n) => `${line} 項目${n}`).join(' ');
    let bytes;
    let headings = [];
    let contents = [body];
    if (ext === 'txt') bytes = Buffer.from(body);
    else if (ext === 'md') { bytes = Buffer.from(`# ${heading}\n${body}`); headings = [heading]; contents = [`# ${heading}\n${body}`]; }
    else if (ext === 'docx') {
      bytes = office({ 'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${heading}</w:t></w:r></w:p><w:p><w:r><w:t>${body}</w:t></w:r></w:p></w:body></w:document>` });
      headings = [heading]; contents = [heading, body];
    } else if (ext === 'pptx') {
      bytes = office({
        'ppt/presentation.xml': '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId r:id="rId1"/></p:sldIdLst></p:presentation>',
        'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>',
        'ppt/slides/slide1.xml': `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><a:p><a:r><a:t>${heading}</a:t></a:r></a:p></p:sp><p:sp><a:p><a:r><a:t>${body}</a:t></a:r></a:p></p:sp></p:sld>`,
      });
      headings = [heading]; contents = [`${heading}\n${body}`];
    } else if (ext === 'xlsx') {
      bytes = office({
        'xl/workbook.xml': `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${heading}" r:id="rId1"/></sheets></workbook>`,
        'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
        'xl/worksheets/sheet1.xml': `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${body}</t></is></c></row></sheetData></worksheet>`,
      }); headings = [heading];
    } else { bytes = pdf; contents = ['First page searchable text', '第二頁中文測試']; }
    await writeFile(path.join(directory, filename), bytes);
    // 整秒時間讓不同檔案系統可重現相同次序。
    const modifiedAtMs = 1700000000000 + i * 1000;
    await utimes(path.join(directory, filename), modifiedAtMs / 1000, modifiedAtMs / 1000);
    documents.push({ filename, extension: `.${ext}`, modifiedAtMs, sizeBytes: bytes.length, headings, contents });
  }
  return { version: datasetVersion, seed, count, sourceBytes: documents.reduce((sum, d) => sum + d.sizeBytes, 0),
    formatCounts: Object.fromEntries(formats.map(ext => [ext, documents.filter(d => d.extension === `.${ext}`).length])), documents, queries };
}

// 獨立於正式搜尋實作的預期結果，依產生時已知文字核對文件數、內容與排序。
export function expectedFiles(manifest, query, types, limit = 20) {
  const key = query.trim().normalize('NFKC').toLowerCase();
  const contains = text => text.normalize('NFKC').toLowerCase().includes(key);
  return manifest.documents.filter(d => !types || types.split(',').includes(d.extension.slice(1))).map(d => ({ ...d,
    rank: d.filename.normalize('NFKC').toLowerCase() === key ? 4 : contains(d.filename) ? 3
      : d.headings.some(contains) ? 2 : d.contents.some(contains) ? 1 : 0,
  })).filter(d => d.rank).sort((a, b) => b.rank - a.rank || b.modifiedAtMs - a.modifiedAtMs
    || (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0)).slice(0, limit).map(d => d.filename);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('用法：node scripts/dataset.mjs <新的輸出目錄> [文件數]');
  const output = path.resolve(process.argv[2]);
  // 不覆寫使用者既有目錄；CLI 產生資料只允許新的專用目錄。
  await mkdir(output);
  const manifest = await generateDataset(path.join(output, '文件'), Number(process.argv[3] ?? 1000));
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`已建立 ${manifest.count} 份合成測試文件：${output}`);
}
