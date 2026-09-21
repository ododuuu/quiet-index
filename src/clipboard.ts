import { execFile } from "node:child_process";
import path from "node:path";

export class ClipboardError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "ClipboardError"; }
}

export interface ClipboardPlan { executable: string; args: string[]; env: NodeJS.ProcessEnv }

export function clipboardPlan(platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env): ClipboardPlan {
  if (platform === "darwin") return { executable: "/usr/bin/pbcopy", args: [], env: { ...environment } };
  if (platform !== "win32") throw new ClipboardError("CONTEXT_CLIPBOARD_UNSUPPORTED", "此平台尚未支援剪貼簿輸出；請改用 --out。");
  const systemRoot = environment.SystemRoot ?? environment.SYSTEMROOT ?? "C:\\Windows";
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "try {",
    "  [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)",
    "  Set-Clipboard -Value ([Console]::In.ReadToEnd())",
    "  exit 0",
    "} catch { exit 1 }",
  ].join("\n");
  return {
    executable: path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    env: { ...environment, SystemRoot: systemRoot },
  };
}

export function copyToClipboard(text: string, plan = clipboardPlan(), timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(plan.executable, plan.args,
      { env: plan.env, shell: false, windowsHide: true, timeout: timeoutMs, maxBuffer: 16384 }, error => {
        if (error) reject(new ClipboardError("CONTEXT_CLIPBOARD_FAILED", "無法寫入本機剪貼簿；請確認系統命令與公司政策，或改用 --out。"));
        else resolve();
      });
    child.stdin?.on("error", () => {});
    child.stdin?.end(text, "utf8");
  });
}
