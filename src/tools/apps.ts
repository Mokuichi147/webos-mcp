import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DeviceManager } from "../devices.js";
import { deviceParam, guarded, json, ok } from "./helpers.js";

export function registerAppTools(server: McpServer, manager: DeviceManager): void {
  server.registerTool(
    "list_apps",
    {
      title: "アプリ一覧",
      description: "TV にインストールされているアプリの ID とタイトルを返す。launch_app にはこの id を渡す。",
      inputSchema: {
        device: deviceParam,
        includeHidden: z.boolean().optional().describe("非表示アプリも含める。既定 false"),
      },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ device, includeHidden }) => {
      const { tv } = await manager.connect(device);
      const apps = await tv.listApps();
      const filtered = includeHidden ? apps : apps.filter((a) => a.visible !== false);
      return json(filtered.map(({ id, title, version }) => ({ id, title, version })));
    }),
  );

  server.registerTool(
    "get_current_app",
    {
      title: "前面アプリを取得",
      description: "現在前面に表示されているアプリの ID を返す。",
      inputSchema: { device: deviceParam },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ device }) => {
      const { tv } = await manager.connect(device);
      const fg = await tv.getForegroundApp();
      if (!fg.appId) return ok("前面アプリなし（スタンバイ中の可能性）", { appId: "" });
      const apps = await tv.listApps().catch(() => []);
      const title = apps.find((a) => a.id === fg.appId)?.title;
      return json({ appId: fg.appId, title });
    }),
  );

  server.registerTool(
    "launch_app",
    {
      title: "アプリ起動",
      description:
        "アプリ ID（例: netflix, youtube.leanback.v4, com.webos.app.hdmi1）でアプリを起動する。任意で起動パラメータを渡せる。",
      inputSchema: {
        device: deviceParam,
        appId: z.string().describe("起動するアプリ ID"),
        params: z.record(z.string(), z.unknown()).optional().describe("アプリへ渡すパラメータ（contentId など）"),
      },
    },
    guarded(async ({ device, appId, params }) => {
      const { tv } = await manager.connect(device);
      const res = await tv.launchApp(appId, params);
      return ok(`起動しました: ${appId}`, { appId, ...res });
    }),
  );

  server.registerTool(
    "close_app",
    {
      title: "アプリ終了",
      description: "指定したアプリを終了する。",
      inputSchema: { device: deviceParam, appId: z.string().describe("終了するアプリ ID") },
    },
    guarded(async ({ device, appId }) => {
      const { tv } = await manager.connect(device);
      await tv.closeApp(appId);
      return ok(`終了しました: ${appId}`);
    }),
  );

  server.registerTool(
    "open_url",
    {
      title: "URL をブラウザで開く",
      description: "TV のブラウザで URL を開く。",
      inputSchema: { device: deviceParam, url: z.string().url().describe("開く URL") },
    },
    guarded(async ({ device, url }) => {
      const { tv } = await manager.connect(device);
      await tv.openUrl(url);
      return ok(`開きました: ${url}`);
    }),
  );
}
