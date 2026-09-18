import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DeviceManager } from "../devices.js";
import { deviceParam, guarded, json, ok } from "./helpers.js";

export function registerAudioTools(server: McpServer, manager: DeviceManager): void {
  server.registerTool(
    "get_volume",
    {
      title: "音量取得",
      description: "現在の音量とミュート状態を返す。",
      inputSchema: { device: deviceParam },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ device }) => {
      const { tv } = await manager.connect(device);
      return json(await tv.getVolume());
    }),
  );

  server.registerTool(
    "volume_up",
    {
      title: "音量を上げる",
      description: "音量を 1 段階上げる。",
      inputSchema: { device: deviceParam },
    },
    guarded(async ({ device }) => {
      const { tv } = await manager.connect(device);
      await tv.volumeUp();
      const v = await tv.getVolume().catch(() => undefined);
      return ok(v ? `音量: ${v.volume}` : "音量を上げました", v as Record<string, unknown> | undefined);
    }),
  );

  server.registerTool(
    "volume_down",
    {
      title: "音量を下げる",
      description: "音量を 1 段階下げる。",
      inputSchema: { device: deviceParam },
    },
    guarded(async ({ device }) => {
      const { tv } = await manager.connect(device);
      await tv.volumeDown();
      const v = await tv.getVolume().catch(() => undefined);
      return ok(v ? `音量: ${v.volume}` : "音量を下げました", v as Record<string, unknown> | undefined);
    }),
  );

  server.registerTool(
    "set_volume",
    {
      title: "音量を設定",
      description: "音量を 0〜100 で設定する。",
      inputSchema: { device: deviceParam, volume: z.number().int().min(0).max(100).describe("音量 (0-100)") },
    },
    guarded(async ({ device, volume }) => {
      const { tv } = await manager.connect(device);
      await tv.setVolume(volume);
      return ok(`音量を ${volume} に設定しました`, { volume });
    }),
  );

  server.registerTool(
    "mute",
    {
      title: "ミュート切替",
      description: "ミュートを ON/OFF する。mute 省略時はトグル。",
      inputSchema: {
        device: deviceParam,
        mute: z.boolean().optional().describe("true でミュート、false で解除。省略時はトグル"),
      },
    },
    guarded(async ({ device, mute }) => {
      const { tv } = await manager.connect(device);
      const next = mute ?? !(await tv.getVolume()).muted;
      await tv.setMute(next);
      return ok(next ? "ミュートしました" : "ミュートを解除しました", { muted: next });
    }),
  );

  server.registerTool(
    "get_sound_output",
    {
      title: "音声出力先を取得",
      description:
        "現在の音声出力先を返す（tv_speaker, external_optical, external_arc, bt_soundbar, headphone など）。",
      inputSchema: { device: deviceParam },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ device }) => {
      const { tv } = await manager.connect(device);
      return json({ soundOutput: await tv.getSoundOutput() });
    }),
  );

  server.registerTool(
    "set_sound_output",
    {
      title: "音声出力先を変更",
      description: "音声出力先を切り替える。",
      inputSchema: {
        device: deviceParam,
        output: z
          .string()
          .describe(
            "出力先 ID（例: tv_speaker, external_optical, external_arc, bt_soundbar, headphone, tv_external_speaker）",
          ),
      },
    },
    guarded(async ({ device, output }) => {
      const { tv } = await manager.connect(device);
      await tv.setSoundOutput(output);
      return ok(`音声出力先を変更しました: ${output}`, { soundOutput: output });
    }),
  );
}
