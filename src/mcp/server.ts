import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRequire } from "node:module";
import type { DeviceManager } from "../devices.js";
import { registerAllTools } from "../tools/index.js";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json") as { version: string };

export function createServer(manager: DeviceManager): McpServer {
  const server = new McpServer(
    { name: "webos-mcp", version },
    {
      instructions: [
        "LG webOS TV を SSAP 経由で操作する MCP サーバー。",
        "初回は discover_devices で TV を探し、pair_device で TV 画面の承認を得て登録する。",
        "以降は device を省略すれば既定デバイスに対して操作できる。",
      ].join("\n"),
    },
  );
  registerAllTools(server, manager);
  return server;
}

export async function runStdio(manager: DeviceManager): Promise<void> {
  const server = createServer(manager);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = () => {
    manager.closeAll();
    server.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.on("close", shutdown);
}
