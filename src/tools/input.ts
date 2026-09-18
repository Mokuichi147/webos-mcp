import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DeviceManager } from "../devices.js";
import { KEY_NAMES } from "../ssap/index.js";
import { deviceParam, guarded, json, ok } from "./helpers.js";

export function registerInputTools(server: McpServer, manager: DeviceManager): void {
  server.registerTool(
    "send_key",
    {
      title: "リモコンキー送信",
      description: `リモコンのボタン操作を送る。複数指定すると順に送信する。使用可能なキー: ${KEY_NAMES.join(", ")}`,
      inputSchema: {
        device: deviceParam,
        keys: z
          .union([z.string(), z.array(z.string()).min(1)])
          .describe('キー名、またはキー名の配列（例: ["HOME"], ["DOWN","DOWN","ENTER"]）'),
      },
    },
    guarded(async ({ device, keys }) => {
      const list = (Array.isArray(keys) ? keys : [keys]).map((k) => k.toUpperCase());
      const unknown = list.filter((k) => !(KEY_NAMES as readonly string[]).includes(k));
      if (unknown.length) throw new Error(`不明なキー: ${unknown.join(", ")}`);
      const { tv } = await manager.connect(device);
      await tv.sendKeys(list);
      return ok(`送信しました: ${list.join(" → ")}`, { keys: list });
    }),
  );

  server.registerTool(
    "send_mouse",
    {
      title: "マウス操作",
      description:
        "TV のマウスポインタを操作する。move は相対移動（画面は 1920x1080 相当。screenshot の 960x540 座標の 2 倍）。" +
        "絶対位置に置きたいときは先に大きな負の値で左上に寄せてから移動する（例: move -3000,-3000 → move 960,512）。ブラウザ等でテキスト欄をクリックして仮想キーボードを出すときに使う。",
      inputSchema: {
        device: deviceParam,
        action: z.enum(["move", "click", "scroll"]).describe("操作"),
        dx: z.number().int().optional().describe("move/scroll の水平移動量"),
        dy: z.number().int().optional().describe("move/scroll の垂直移動量"),
      },
    },
    guarded(async ({ device, action, dx, dy }) => {
      const { tv } = await manager.connect(device);
      if (action === "move") await tv.mouseMove(dx ?? 0, dy ?? 0);
      else if (action === "scroll") await tv.mouseScroll(dx ?? 0, dy ?? 0);
      else await tv.mouseClick();
      return ok(`${action}${action !== "click" ? ` (${dx ?? 0}, ${dy ?? 0})` : ""} を送信しました`);
    }),
  );

  server.registerTool(
    "list_inputs",
    {
      title: "外部入力一覧",
      description: "HDMI などの外部入力の ID・ラベル・接続状態を返す。switch_input にはこの id を渡す。",
      inputSchema: { device: deviceParam },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ device }) => {
      const { tv } = await manager.connect(device);
      const inputs = await tv.listInputs();
      return json(inputs.map(({ id, label, connected, appId }) => ({ id, label, connected, appId })));
    }),
  );

  server.registerTool(
    "switch_input",
    {
      title: "外部入力を切替",
      description: "外部入力を切り替える（例: HDMI_1, HDMI_2）。",
      inputSchema: { device: deviceParam, inputId: z.string().describe("入力 ID（list_inputs の id）") },
    },
    guarded(async ({ device, inputId }) => {
      const { tv } = await manager.connect(device);
      await tv.switchInput(inputId);
      return ok(`入力を切り替えました: ${inputId}`, { inputId });
    }),
  );

  server.registerTool(
    "insert_text",
    {
      title: "文字入力",
      description:
        "TV 上でフォーカスされているテキストフィールド（検索欄など）に文字列を入力する。入力欄が表示されていないと失敗する。enter=true で入力後に確定する。",
      inputSchema: {
        device: deviceParam,
        text: z.string().describe("入力する文字列"),
        replace: z.boolean().optional().describe("既存の入力内容を置き換える。既定 false（末尾に追記）"),
        enter: z.boolean().optional().describe("入力後に Enter を送る。既定 false"),
      },
    },
    guarded(async ({ device, text, replace, enter }) => {
      const { tv } = await manager.connect(device);
      await tv.insertText(text, replace ?? false);
      if (enter) await tv.sendEnterKey();
      return ok(`入力しました: ${text}${enter ? " (Enter)" : ""}`);
    }),
  );

  server.registerTool(
    "delete_text",
    {
      title: "文字削除",
      description: "フォーカス中のテキストフィールドからカーソル前の文字を削除する。",
      inputSchema: {
        device: deviceParam,
        count: z.number().int().min(1).max(500).optional().describe("削除する文字数。既定 1"),
      },
    },
    guarded(async ({ device, count }) => {
      const { tv } = await manager.connect(device);
      await tv.deleteCharacters(count ?? 1);
      return ok(`${count ?? 1} 文字削除しました`);
    }),
  );

  server.registerTool(
    "media_control",
    {
      title: "再生制御",
      description: "再生・一時停止・停止・巻き戻し・早送りを送る。アプリによっては対応していない。",
      inputSchema: {
        device: deviceParam,
        action: z.enum(["play", "pause", "stop", "rewind", "fastForward"]).describe("操作"),
      },
    },
    guarded(async ({ device, action }) => {
      const { tv } = await manager.connect(device);
      await tv.mediaControl(action);
      return ok(`送信しました: ${action}`);
    }),
  );
}
