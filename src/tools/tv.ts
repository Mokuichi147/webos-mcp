import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DeviceManager } from "../devices.js";
import type { ChannelInfo } from "../ssap/index.js";
import { deviceParam, guarded, json, ok } from "./helpers.js";

const NOT_WATCHING =
  "放送を視聴していません（アプリまたは外部入力を表示中）。watch_tv で放送視聴に切り替えてください。";

/** 全角英数・空白を半角に寄せて比較しやすくする */
function normalize(s: string): string {
  return s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s　・]/g, "")
    .toLowerCase();
}

function findChannel(channels: ChannelInfo[], query: string): ChannelInfo | undefined {
  const q = normalize(query);
  const visible = channels.filter((c) => !c.skipped);
  return (
    visible.find((c) => c.channelId === query) ??
    visible.find((c) => c.number === query || c.number === q.padStart(3, "0")) ??
    visible.find((c) => normalize(c.name) === q) ??
    visible.find((c) => normalize(c.name).startsWith(q)) ??
    visible.find((c) => normalize(c.name).includes(q))
  );
}

function briefChannel(c: ChannelInfo) {
  return { channelId: c.channelId, number: c.number, name: c.name, type: c.type };
}

export function registerTvTools(server: McpServer, manager: DeviceManager): void {
  server.registerTool(
    "watch_tv",
    {
      title: "放送視聴に切替",
      description: "アプリや外部入力からテレビ放送（チューナー）の視聴に切り替える。",
      inputSchema: { device: deviceParam },
    },
    guarded(async ({ device }) => {
      const { tv } = await manager.connect(device);
      await tv.ensureLiveTv();
      const cur = await tv.getCurrentChannel();
      return ok(
        cur ? `放送視聴中: ${cur.number} ${cur.name}` : "放送視聴に切り替えました",
        cur as Record<string, unknown> | undefined,
      );
    }),
  );

  server.registerTool(
    "list_channels",
    {
      title: "チャンネル一覧",
      description:
        "受信可能なチャンネル一覧を返す。type で放送種別を絞り込める（例: Terrestrial=地デジ, BS, CS, UHD=4K）。set_channel には number / name / channelId のいずれでも渡せる。",
      inputSchema: {
        device: deviceParam,
        type: z.string().optional().describe("放送種別の部分一致フィルタ（例: Terrestrial, BS, CS, UHD）"),
        query: z.string().optional().describe("局名の部分一致フィルタ"),
        includeSkipped: z.boolean().optional().describe("スキップ設定されたチャンネルも含める。既定 false"),
      },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ device, type, query, includeSkipped }) => {
      const { tv } = await manager.connect(device);
      let channels = await tv.listChannels();
      if (!includeSkipped) channels = channels.filter((c) => !c.skipped);
      if (type) channels = channels.filter((c) => c.type.toLowerCase().includes(type.toLowerCase()));
      if (query) channels = channels.filter((c) => normalize(c.name).includes(normalize(query)));
      return json(channels.map(briefChannel));
    }),
  );

  server.registerTool(
    "get_current_channel",
    {
      title: "現在のチャンネルと番組",
      description:
        "視聴中のチャンネルと、放送中の番組名・内容・開始/終了時刻を返す。放送視聴中でない場合はその旨を返す。",
      inputSchema: { device: deviceParam },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ device }) => {
      const { tv } = await manager.connect(device);
      const cur = await tv.getCurrentChannel();
      if (!cur) return ok(NOT_WATCHING);
      return json(cur);
    }),
  );

  server.registerTool(
    "get_program_guide",
    {
      title: "番組表",
      description:
        "視聴中チャンネルの番組表（これから放送される番組の一覧）を返す。放送視聴中でない場合はその旨を返す。",
      inputSchema: { device: deviceParam },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ device }) => {
      const { tv } = await manager.connect(device);
      const guide = await tv.getProgramGuide();
      if (!guide) return ok(NOT_WATCHING);
      return json(guide);
    }),
  );

  server.registerTool(
    "set_channel",
    {
      title: "選局",
      description:
        "チャンネルを切り替える。channel には番号（例: 011, 41）、局名（例: NHK総合, テレ東）、channelId のいずれかを指定。放送視聴中でなければ自動で切り替える。",
      inputSchema: { device: deviceParam, channel: z.string().min(1).describe("番号 / 局名 / channelId") },
    },
    guarded(async ({ device, channel }) => {
      const { tv } = await manager.connect(device);
      const hit = findChannel(await tv.listChannels(), channel);
      if (!hit) throw new Error(`チャンネルが見つかりません: ${channel}（list_channels で確認してください）`);
      await tv.openChannel(hit.channelId);
      await new Promise((r) => setTimeout(r, 1500));
      const cur = await tv.getCurrentChannel();
      return ok(`選局しました: ${hit.number} ${hit.name}`, { ...briefChannel(hit), program: cur?.program });
    }),
  );

  server.registerTool(
    "channel_up",
    {
      title: "チャンネルを上げる",
      description: "次のチャンネルへ切り替える。",
      inputSchema: { device: deviceParam },
    },
    guarded(async ({ device }) => {
      const { tv } = await manager.connect(device);
      await tv.channelUp();
      await new Promise((r) => setTimeout(r, 1500));
      const cur = await tv.getCurrentChannel();
      return ok(
        cur ? `${cur.number} ${cur.name}` : "チャンネルを上げました",
        cur as Record<string, unknown> | undefined,
      );
    }),
  );

  server.registerTool(
    "channel_down",
    {
      title: "チャンネルを下げる",
      description: "前のチャンネルへ切り替える。",
      inputSchema: { device: deviceParam },
    },
    guarded(async ({ device }) => {
      const { tv } = await manager.connect(device);
      await tv.channelDown();
      await new Promise((r) => setTimeout(r, 1500));
      const cur = await tv.getCurrentChannel();
      return ok(
        cur ? `${cur.number} ${cur.name}` : "チャンネルを下げました",
        cur as Record<string, unknown> | undefined,
      );
    }),
  );
}
