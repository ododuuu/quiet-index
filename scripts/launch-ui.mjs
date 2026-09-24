import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const token = randomBytes(24).toString("base64url");
const state = { phase: "準備啟動", detail: "正在檢查 Seekah 元件…", log: [] };

function appendLog(text) {
  for (const line of text.toString("utf8").split(/\r?\n/u)) {
    const clean = line.replace(/[\u0000-\u001f\u007f]/gu, " ").trim();
    if (clean) state.log = [...state.log.slice(-7), clean.slice(0, 300)];
  }
}

function html() {
  return `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Seekah 正在啟動</title><style>body{margin:0;background:#101725;color:#edf2ff;font:16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:grid;min-height:100vh;place-items:center}.card{width:min(560px,calc(100% - 40px));padding:32px;border:1px solid #3a4c70;border-radius:16px;background:#182235;box-shadow:0 20px 60px #0007}h1{margin:0 0 18px;font-size:24px}#phase{font-weight:700;color:#9bc4ff}#detail{line-height:1.6}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto;padding:12px;border-radius:8px;background:#0d1420;color:#bac8e2;font-size:12px}</style><main class="card"><h1>Seekah</h1><p id="phase">正在準備啟動…</p><p id="detail">正在檢查元件。</p><pre id="log" hidden></pre></main><script>const token=location.hash.slice(1);async function update(){const r=await fetch('/status',{headers:{'x-seekah-launch-token':token}});if(!r.ok)return;const s=await r.json();document.querySelector('#phase').textContent=s.phase;document.querySelector('#detail').textContent=s.detail;const log=document.querySelector('#log');log.hidden=!s.log.length;log.textContent=s.log.join('\n');if(s.done)return;setTimeout(update,400)}update()</script></html>`;
}

function startBrowser(url) {
  const command = process.platform === "win32" ? "rundll32.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: project, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", appendLog);
    child.stderr.on("data", appendLog);
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`${command} 結束碼 ${code ?? "未知"}`)));
  });
}

const server = createServer((request, response) => {
  if (request.headers.host !== `127.0.0.1:${server.address()?.port}`) { response.writeHead(421); response.end(); return; }
  if (request.url === "/") { response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); response.end(html()); return; }
  if (request.url === "/status" && request.headers["x-seekah-launch-token"] === token) {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); response.end(JSON.stringify(state)); return;
  }
  response.writeHead(404); response.end();
});

await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const address = server.address();
if (!address || typeof address === "string") throw new Error("無法啟動 Seekah 啟動畫面。");
startBrowser(`http://127.0.0.1:${address.port}/#${token}`);

try {
  const cli = path.join(project, "dist", "src", "cli.js");
  if (!existsSync(path.join(project, "node_modules")) || !existsSync(cli)) {
    state.phase = "正在建立相依…";
    state.detail = "首次啟動會下載相依套件並自動建立 Seekah 程式；請保持此畫面開啟。";
    await run(process.platform === "win32" ? "npm.cmd" : "npm", ["ci"]);
    if (!existsSync(cli)) throw new Error("相依建立完成，但找不到 Seekah 程式。");
  }
  state.phase = "相依與程式已建立完成";
  state.detail = "正在開啟 Seekah；第一次索引會在下一個畫面由你選擇資料夾後開始。";
  const child = spawn(process.execPath, [cli, "ui"], { cwd: project, detached: true, stdio: "ignore" });
  child.on("error", error => { state.phase = "無法開啟 Seekah"; state.detail = error.message; state.done = true; });
  child.unref();
  state.done = true;
  setTimeout(() => server.close(), 1500).unref();
} catch (error) {
  state.phase = "啟動失敗";
  state.detail = error instanceof Error ? error.message : "無法完成相依建立。";
  state.done = true;
}
