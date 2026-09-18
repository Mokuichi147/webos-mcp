import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DeviceManager } from "../devices.js";
import { sendMagicPacket } from "../ssap/index.js";
import { deviceParam, guarded, json, ok } from "./helpers.js";

export function registerSystemTools(server: McpServer, manager: DeviceManager): void {
  server.registerTool(
    "power_off",
    {
      title: "電源オフ",
      description: "TV の電源を切る（スタンバイ）。",
      inputSchema: { device: deviceParam },
      annotations: { destructiveHint: true },
    },
    guarded(async ({ device }) => {
      const { tv } = await manager.connect(device);
      await tv.powerOff();
      return ok("電源を切りました");
    }),
  );

  server.registerTool(
    "get_power_state",
    {
      title: "電源状態",
      description:
        "TV の電源状態を返す（Active / Active Standby / Screen Off など）。TV がスタンバイで応答しない場合はその旨を返す。",
      inputSchema: { device: deviceParam },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ device }) => {
      try {
        const { tv } = await manager.connect(device);
        return json(await tv.getPowerState());
      } catch (err) {
        return ok(
          `TV に接続できません（電源オフまたはスタンバイの可能性）: ${err instanceof Error ? err.message : String(err)}`,
          {
            state: "Unreachable",
          },
        );
      }
    }),
  );

  server.registerTool(
    "power_on",
    {
      title: "電源オン (Wake-on-LAN)",
      description:
        "Wake-on-LAN で TV の電源を入れる。pair_device 時に保存した MAC アドレスを使う（mac パラメータで上書き可）。TV 側で「ネットワーク経由で電源オン」等の設定が有効である必要がある。",
      inputSchema: {
        device: deviceParam,
        mac: z.string().optional().describe("送信先 MAC アドレス（省略時は登録済みの値）"),
      },
    },
    guarded(async ({ device, mac }) => {
      const record = await manager.resolve(device);
      const macs = mac ? [mac] : [record.mac, record.wifiMac].filter((m): m is string => !!m);
      if (macs.length === 0) {
        throw new Error("MAC アドレスが登録されていません。pair_device を再実行するか mac を指定してください。");
      }
      await Promise.all(macs.map((m) => sendMagicPacket(m)));
      return ok(`マジックパケットを送信しました: ${macs.join(", ")}`, { macs });
    }),
  );

  server.registerTool(
    "get_settings",
    {
      title: "設定を取得",
      description:
        "システム設定を取得する。例: category=picture keys=[brightness,contrast,backlight,color,pictureMode] / category=sound keys=[soundMode]。",
      inputSchema: {
        device: deviceParam,
        category: z.string().describe("設定カテゴリ（picture, sound, option, network, time など）"),
        keys: z.array(z.string()).min(1).describe("取得するキー"),
      },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ device, category, keys }) => {
      const { tv } = await manager.connect(device);
      return json(await tv.getSettings(category, keys));
    }),
  );

  server.registerTool(
    "set_settings",
    {
      title: "設定を変更",
      description:
        "システム設定を変更する。例: category=picture settings={backlight: 60}。TV のファームウェアによっては WRITE_SETTINGS 権限がなく 401 になる。",
      inputSchema: {
        device: deviceParam,
        category: z.string().describe("設定カテゴリ"),
        settings: z.record(z.string(), z.unknown()).describe("変更するキーと値"),
      },
    },
    guarded(async ({ device, category, settings }) => {
      const { tv } = await manager.connect(device);
      await tv.setSettings(category, settings);
      return ok(`設定を変更しました: ${category} ${JSON.stringify(settings)}`);
    }),
  );

  server.registerTool(
    "show_toast",
    {
      title: "トースト通知",
      description: "TV 画面にトースト通知を表示する。",
      inputSchema: { device: deviceParam, message: z.string().min(1).max(200).describe("表示するメッセージ") },
    },
    guarded(async ({ device, message }) => {
      const { tv } = await manager.connect(device);
      await tv.showToast(message);
      return ok(`表示しました: ${message}`);
    }),
  );

  server.registerTool(
    "screenshot",
    {
      title: "スクリーンショット",
      description:
        "TV 画面のスクリーンショット (960x540 JPEG) を取得する。現在の表示内容を確認してから操作したいときに使う。DRM 保護された動画（Netflix / Prime Video 等の再生中）は黒く写る。",
      inputSchema: { device: deviceParam },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ device }) => {
      const { tv } = await manager.connect(device);
      const [image, fg] = await Promise.all([tv.captureScreen(), tv.getForegroundApp().catch(() => undefined)]);
      return {
        content: [
          { type: "image", data: image.toString("base64"), mimeType: "image/jpeg" },
          { type: "text", text: `前面アプリ: ${fg?.appId ?? "不明"} (960x540)` },
        ],
      };
    }),
  );

  server.registerTool(
    "get_system_info",
    {
      title: "システム情報",
      description: "TV のモデル名・webOS バージョン等を返す。",
      inputSchema: { device: deviceParam },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ device }) => {
      const { tv } = await manager.connect(device);
      const [system, software] = await Promise.all([
        tv.getSystemInfo().catch((e: Error) => ({ error: e.message })),
        tv.getSoftwareInfo().catch((e: Error) => ({ error: e.message })),
      ]);
      return json({ system, software });
    }),
  );
}
