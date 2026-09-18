#!/usr/bin/env node
import { parseArgs } from "node:util";
import { DeviceStore, defaultConfigDir } from "./config/store.js";
import { DeviceManager } from "./devices.js";
import { runStdio } from "./mcp/server.js";
import { discoverDevices } from "./ssap/index.js";
import { log } from "./log.js";

const HELP = `webos-mcp — LG webOS TV 用 MCP サーバー (stdio)

使い方:
  webos-mcp [options]              MCP サーバーを起動
  webos-mcp discover               LAN 上の TV を探索して表示
  webos-mcp pair <host> [--name N] TV とペアリングして保存

オプション:
  --device <name>      既定デバイス名（環境変数 WEBOS_DEVICE でも可）
  --host <ip>          設定ファイルを使わず直接接続する TV の IP（WEBOS_HOST）
  --client-key <key>   --host と併用する client-key（WEBOS_CLIENT_KEY）
  --config-dir <dir>   設定ディレクトリ（既定: ${defaultConfigDir()}）
  --name <name>        pair 時の表示名
  --debug              デバッグログを stderr に出力（WEBOS_MCP_DEBUG=1）
  -h, --help           このヘルプ
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      device: { type: "string" },
      host: { type: "string" },
      "client-key": { type: "string" },
      "config-dir": { type: "string" },
      name: { type: "string" },
      debug: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    process.stdout.write(HELP);
    return;
  }
  if (values.debug) process.env.WEBOS_MCP_DEBUG = "1";

  const store = new DeviceStore(values["config-dir"] ?? process.env.WEBOS_CONFIG_DIR);
  const host = values.host ?? process.env.WEBOS_HOST;
  const manager = new DeviceManager({
    store,
    defaultDevice: values.device ?? process.env.WEBOS_DEVICE,
    adHoc: host ? { host, clientKey: values["client-key"] ?? process.env.WEBOS_CLIENT_KEY } : undefined,
  });

  const [command, ...rest] = positionals;
  switch (command) {
    case undefined:
    case "serve":
      await runStdio(manager);
      return;

    case "discover": {
      process.stderr.write("探索中...\n");
      const found = await discoverDevices(3000);
      if (found.length === 0) {
        process.stdout.write("TV が見つかりませんでした\n");
        return;
      }
      for (const d of found) {
        process.stdout.write(`${d.host}\t${d.friendlyName ?? "-"}\t${d.model ?? "-"}\t${d.id ?? "-"}\n`);
      }
      return;
    }

    case "pair": {
      const target = rest[0];
      if (!target) {
        process.stderr.write("使い方: webos-mcp pair <host> [--name <name>]\n");
        process.exit(2);
      }
      process.stderr.write(`TV (${target}) に接続します。TV 画面で承認してください...\n`);
      const saved = await manager.pair(target, { name: values.name, makeDefault: true });
      process.stdout.write(`ペアリング完了: ${saved.name} (${saved.host})\n保存先: ${store.filePath}\n`);
      return;
    }

    default:
      process.stderr.write(`不明なコマンド: ${command}\n\n${HELP}`);
      process.exit(2);
  }
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
