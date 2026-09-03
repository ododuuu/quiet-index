#!/usr/bin/env node

export function buildHelpText(): string {
  return [
    "LocalDocSearch",
    "",
    "目前里程碑：專案骨架與規格已建立，搜尋命令將在下一個里程碑實作。",
    "",
    "預定命令：",
    "  docsearch index <root>",
    "  docsearch search <query> [--limit <number>]",
    "  docsearch status",
  ].join("\n");
}

export function main(args: readonly string[]): number {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(buildHelpText());
    return 0;
  }

  console.error(`尚未實作命令：${args[0] ?? ""}`);
  console.error("請使用 --help 查看目前狀態。");
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main(process.argv.slice(2));
}
