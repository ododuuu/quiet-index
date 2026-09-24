import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(project, "dist", "src", "cli.js");

function say(text) {
  process.stdout.write(`${text}\n`);
}

function startBrowser(url) {
  const command = process.platform === "win32" ? "cmd.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true, shell: false });
  child.on("error", error => say(`無法開啟瀏覽器：${error.message}`));
  child.unref();
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: project,
      stdio: ["ignore", "pipe", "pipe"],
      shell: options.shell === true,
      windowsHide: false,
      env: process.env,
    });
    const print = chunk => process.stdout.write(chunk);
    child.stdout.on("data", print);
    child.stderr.on("data", print);
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`${command} 結束碼 ${code ?? "未知"}`)));
  });
}

function waitForWorkbench(child) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("工作台啟動逾時。")), 30_000);
    const onData = chunk => {
      const text = chunk.toString("utf8");
      process.stdout.write(text);
      buffer += text;
      const match = buffer.match(/本機工作台：(http:\/\/127\.0\.0\.1:\d+\/#\S+)/u);
      if (!match) return;
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
      resolve(match[1]);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", code => {
      clearTimeout(timer);
      reject(new Error(`工作台在印出網址前結束，結束碼 ${code ?? "未知"}。`));
    });
  });
}

try {
  if (!process.execPath) throw new Error("找不到 Node.js。");
  say("Seekah 正在啟動。這個視窗會顯示進度，完成前請不要關閉。");
  if (!existsSync(path.join(project, "node_modules")) || !existsSync(cli)) {
    say(existsSync(cli) ? "正在建立相依套件（程式已存在，略過重建）…" : "正在建立相依套件並編譯程式…");
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const args = existsSync(cli) ? ["ci", "--ignore-scripts"] : ["ci"];
    await run(npm, args, { shell: process.platform === "win32" });
    if (!existsSync(cli)) throw new Error("相依建立完成，但找不到 Seekah 程式。");
  } else {
    say("相依與程式已就緒，略過安裝。");
  }
  say("相依與程式已建立完成。正在開啟工作台…");
  const child = spawn(process.execPath, [cli, "ui", "--no-open"], {
    cwd: project,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false,
    env: process.env,
  });
  const url = await waitForWorkbench(child);
  say("正在開啟瀏覽器。請不要關閉這個視窗，關閉會結束 Seekah。");
  startBrowser(url);
  const code = await new Promise(resolve => child.once("exit", value => resolve(value ?? 0)));
  process.exitCode = code;
} catch (error) {
  say(`啟動失敗：${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
