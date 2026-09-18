import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DeviceManager } from "../devices.js";
import { discoverDevices } from "../ssap/index.js";
import { guarded, json, ok } from "./helpers.js";

export function registerDeviceTools(server: McpServer, manager: DeviceManager): void {
  server.registerTool(
    "discover_devices",
    {
      title: "TV を探索",
      description: "LAN 上の LG webOS TV を SSDP で探索し、IP・名前・モデルを返す。",
      inputSchema: {
        timeoutMs: z.number().int().min(500).max(15000).optional().describe("探索の待ち時間 (ms)。既定 3000"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guarded(async ({ timeoutMs }) => {
      const found = await discoverDevices(timeoutMs ?? 3000);
      const registered = await manager.deviceStore.list();
      const result = found.map((d) => ({
        ...d,
        paired: registered.some((r) => r.host === d.host && !!r.clientKey),
      }));
      if (result.length === 0) {
        return ok("webOS TV が見つかりませんでした。TV の電源と同一 LAN 接続を確認してください。");
      }
      return json(result);
    }),
  );

  server.registerTool(
    "pair_device",
    {
      title: "TV とペアリング",
      description:
        "指定した IP の TV に接続してペアリングする。TV 画面に表示される承認ダイアログでユーザーが「はい」を選ぶまで待機し、client-key を保存する。",
      inputSchema: {
        host: z.string().describe("TV の IP アドレスまたはホスト名"),
        name: z.string().optional().describe("保存する表示名（例: living-room）。省略時は host"),
        makeDefault: z.boolean().optional().describe("既定デバイスにするか"),
      },
    },
    guarded(async ({ host, name, makeDefault }) => {
      const saved = await manager.pair(host, { name, makeDefault });
      return ok(`ペアリング完了: ${saved.name} (${saved.host})`, {
        name: saved.name,
        host: saved.host,
        model: saved.model,
        paired: !!saved.clientKey,
      });
    }),
  );

  server.registerTool(
    "list_devices",
    {
      title: "登録済みデバイス一覧",
      description: "devices.json に保存されているデバイスと既定デバイスを返す。",
      annotations: { readOnlyHint: true },
    },
    guarded(async () => {
      const data = await manager.deviceStore.load();
      return json({
        defaultDevice: data.defaultDevice,
        devices: Object.values(data.devices).map((d) => ({
          name: d.name,
          host: d.host,
          model: d.model,
          id: d.id,
          paired: !!d.clientKey,
        })),
      });
    }),
  );

  server.registerTool(
    "remove_device",
    {
      title: "デバイス登録を削除",
      description: "保存済みのデバイス（client-key を含む）を削除する。",
      inputSchema: { name: z.string().describe("削除するデバイス名") },
      annotations: { destructiveHint: true },
    },
    guarded(async ({ name }) => {
      const removed = await manager.deviceStore.remove(name);
      return ok(removed ? `削除しました: ${name}` : `見つかりません: ${name}`);
    }),
  );

  server.registerTool(
    "set_default_device",
    {
      title: "既定デバイスを設定",
      description: "device パラメータ省略時に使うデバイスを設定する。",
      inputSchema: { name: z.string().describe("デバイス名") },
    },
    guarded(async ({ name }) => {
      await manager.deviceStore.setDefault(name);
      return ok(`既定デバイス: ${name}`);
    }),
  );
}
