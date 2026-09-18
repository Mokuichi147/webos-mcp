import https from "node:https";
import type { SsapClient } from "./client.js";

export interface AppInfo {
  id: string;
  title: string;
  version?: string;
  icon?: string;
  visible?: boolean;
}

export interface InputInfo {
  id: string;
  label: string;
  port?: number;
  appId?: string;
  connected?: boolean;
  icon?: string;
}

export interface ChannelInfo {
  channelId: string;
  number: string;
  name: string;
  /** 例: "Terrestrial Digital TV", "Satellite BS", "Satellite CS", "Satellite BSCS UHD" */
  type: string;
  typeId?: number;
  skipped?: boolean;
  locked?: boolean;
  radio?: boolean;
}

export interface ProgramInfo {
  programId?: string;
  name: string;
  description?: string;
  /** ISO 8601 ローカル時刻 */
  startTime?: string;
  endTime?: string;
  durationSec?: number;
  genre?: string;
  rating?: string;
}

export interface CurrentChannel extends ChannelInfo {
  program?: ProgramInfo;
}

export const LIVE_TV_APP_ID = "com.webos.app.livetv";

export interface VolumeStatus {
  volume: number;
  muted: boolean;
  soundOutput?: string;
}

/** SSAP の ssap:// URI をまとめた薄いラッパー。 */
export class TvCommands {
  constructor(private readonly client: SsapClient) {}

  // ---- アプリ -------------------------------------------------------------

  async listApps(): Promise<AppInfo[]> {
    const res = await this.client.request<{ apps: Array<Record<string, unknown>> }>(
      "ssap://com.webos.applicationManager/listApps",
    );
    return (res.apps ?? []).map((a) => ({
      id: String(a.id),
      title: String(a.title ?? ""),
      version: a.version ? String(a.version) : undefined,
      icon: a.icon ? String(a.icon) : undefined,
      // TV/バージョンにより visible または hidden で表現される
      visible: a.visible !== false && a.hidden !== true,
    }));
  }

  async listLaunchPoints(): Promise<AppInfo[]> {
    const res = await this.client.request<{ launchPoints: Array<Record<string, unknown>> }>(
      "ssap://com.webos.applicationManager/listLaunchPoints",
    );
    return (res.launchPoints ?? []).map((a) => ({
      id: String(a.id),
      title: String(a.title ?? ""),
      icon: a.icon ? String(a.icon) : undefined,
    }));
  }

  async getForegroundApp(): Promise<{ appId: string; windowId?: string; processId?: string }> {
    const res = await this.client.request<{ appId: string; windowId?: string; processId?: string }>(
      "ssap://com.webos.applicationManager/getForegroundAppInfo",
    );
    return { appId: res.appId, windowId: res.windowId, processId: res.processId };
  }

  async launchApp(id: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await this.client.request<Record<string, unknown>>("ssap://system.launcher/launch", {
      id,
      ...(params ? { params } : {}),
    });
    await this.waitForForeground(id);
    return res;
  }

  /**
   * 前面アプリが appId になるまで待つ（最大 timeoutMs）。
   * launch / switchInput は TV 側で非同期に処理されるため、直後に別の操作を送ると
   * 後から完了した切替に上書きされることがある。
   */
  async waitForForeground(appId: string, timeoutMs = 5000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const fg = await this.getForegroundApp().catch(() => undefined);
      if (fg?.appId === appId) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  }

  async closeApp(id: string): Promise<Record<string, unknown>> {
    return this.client.request("ssap://system.launcher/close", { id });
  }

  async openUrl(target: string): Promise<Record<string, unknown>> {
    return this.client.request("ssap://system.launcher/open", { target });
  }

  // ---- 音量 -------------------------------------------------------------

  async getVolume(): Promise<VolumeStatus> {
    const res = await this.client.request<Record<string, unknown>>("ssap://audio/getVolume");
    // webOS のバージョンによって volumeStatus に入る場合と直下に入る場合がある
    const status = (res.volumeStatus as Record<string, unknown> | undefined) ?? res;
    return {
      volume: Number(status.volume ?? 0),
      muted: Boolean(status.muteStatus ?? status.muted ?? status.mute ?? false),
      soundOutput: status.soundOutput ? String(status.soundOutput) : undefined,
    };
  }

  async setVolume(volume: number): Promise<void> {
    await this.client.request("ssap://audio/setVolume", { volume: Math.max(0, Math.min(100, Math.round(volume))) });
  }

  async volumeUp(): Promise<void> {
    await this.client.request("ssap://audio/volumeUp");
  }

  async volumeDown(): Promise<void> {
    await this.client.request("ssap://audio/volumeDown");
  }

  async setMute(mute: boolean): Promise<void> {
    await this.client.request("ssap://audio/setMute", { mute });
  }

  // ---- 入力 -------------------------------------------------------------

  async listInputs(): Promise<InputInfo[]> {
    const res = await this.client.request<{ devices: Array<Record<string, unknown>> }>(
      "ssap://tv/getExternalInputList",
    );
    return (res.devices ?? []).map((d) => ({
      id: String(d.id),
      label: String(d.label ?? ""),
      port: d.port as number | undefined,
      appId: d.appId ? String(d.appId) : undefined,
      connected: d.connected as boolean | undefined,
      icon: d.icon ? String(d.icon) : undefined,
    }));
  }

  async switchInput(inputId: string): Promise<void> {
    const appId = (await this.listInputs().catch(() => [])).find((i) => i.id === inputId)?.appId;
    await this.client.request("ssap://tv/switchInput", { inputId });
    if (appId) await this.waitForForeground(appId);
  }

  // ---- 放送（チューナー） ------------------------------------------------

  /** 放送視聴アプリを前面にする。すでに前面なら何もしない。 */
  async ensureLiveTv(): Promise<void> {
    const fg = await this.getForegroundApp().catch(() => undefined);
    if (fg?.appId === LIVE_TV_APP_ID) return;
    await this.launchApp(LIVE_TV_APP_ID);
    // 起動直後はチューナー情報が返らないことがあるので少し待つ
    await new Promise((r) => setTimeout(r, 1500));
  }

  async isWatchingTv(): Promise<boolean> {
    const fg = await this.getForegroundApp().catch(() => undefined);
    return fg?.appId === LIVE_TV_APP_ID;
  }

  async listChannels(): Promise<ChannelInfo[]> {
    const res = await this.client.request<{ channelList: Array<Record<string, unknown>> }>("ssap://tv/getChannelList");
    return (res.channelList ?? []).map((c) => ({
      // 一覧には channelId が含まれないので getCurrentChannel と同じ形式で組み立てる
      channelId: [c.sourceIndex, c.physicalNumber, c.majorNumber, c.minorNumber, c.ONID, c.SVCID, c.TSID].join("_"),
      number: String(c.channelNumber ?? c.majorNumber ?? ""),
      name: String(c.channelName ?? ""),
      type: String(c.channelType ?? ""),
      typeId: c.channelTypeId as number | undefined,
      skipped: c.skipped as boolean | undefined,
      locked: c.locked as boolean | undefined,
      radio: c.Radio as boolean | undefined,
    }));
  }

  /** 現在のチャンネルと番組。放送視聴中でなければ undefined。 */
  async getCurrentChannel(): Promise<CurrentChannel | undefined> {
    if (!(await this.isWatchingTv())) return undefined;
    const ch = await this.client.request<Record<string, unknown>>("ssap://tv/getCurrentChannel");
    const program = await this.client
      .request<Record<string, unknown>>("ssap://tv/getChannelCurrentProgramInfo")
      .then(toProgram)
      .catch(() => undefined);
    return {
      channelId: String(ch.channelId ?? ""),
      number: String(ch.channelNumber ?? ""),
      name: String(ch.channelName ?? ""),
      type: String(ch.channelTypeName ?? ""),
      typeId: ch.channelTypeId as number | undefined,
      skipped: ch.isSkipped as boolean | undefined,
      locked: ch.isLocked as boolean | undefined,
      program,
    };
  }

  /** 現在のチャンネルの番組表。放送視聴中でなければ undefined。 */
  async getProgramGuide(): Promise<{ channel: ChannelInfo; programs: ProgramInfo[] } | undefined> {
    if (!(await this.isWatchingTv())) return undefined;
    const res = await this.client.request<{
      channel: Record<string, unknown>;
      programList: Array<Record<string, unknown>>;
    }>("ssap://tv/getChannelProgramInfo");
    const c = res.channel ?? {};
    return {
      channel: {
        channelId: String(c.channelId ?? ""),
        number: String(c.channelNumber ?? ""),
        name: String(c.channelName ?? ""),
        type: String(c.channelType ?? ""),
        typeId: c.channelTypeId as number | undefined,
      },
      programs: (res.programList ?? []).map(toProgram),
    };
  }

  async openChannel(channelId: string): Promise<void> {
    await this.ensureLiveTv();
    await this.client.request("ssap://tv/openChannel", { channelId });
  }

  async channelUp(): Promise<void> {
    await this.ensureLiveTv();
    await this.client.request("ssap://tv/channelUp");
  }

  async channelDown(): Promise<void> {
    await this.ensureLiveTv();
    await this.client.request("ssap://tv/channelDown");
  }

  // ---- 電源 / ネットワーク ---------------------------------------------------

  /** 電源状態。state は "Active" / "Active Standby" / "Suspend" / "Screen Off" など。 */
  async getPowerState(): Promise<{ state: string; processing?: string }> {
    const res = await this.client.request<{ state: string; processing?: string }>(
      "ssap://com.webos.service.tvpower/power/getPowerState",
    );
    return { state: res.state, processing: res.processing };
  }

  async getNetworkInfo(): Promise<{ wiredMac?: string; wifiMac?: string }> {
    const res = await this.client.request<Record<string, { macAddress?: string } | undefined>>(
      "ssap://com.webos.service.connectionmanager/getinfo",
    );
    return { wiredMac: res.wiredInfo?.macAddress, wifiMac: res.wifiInfo?.macAddress };
  }

  // ---- 文字入力 ------------------------------------------------------------

  /**
   * システム IME（仮想キーボード）がテキストフィールドにフォーカスしているか。
   * アプリ独自のキーボード（YouTube 等）は対象外。
   */
  async isTextFieldFocused(): Promise<boolean> {
    const res = await this.client.subscribeOnce<{ currentWidget?: { focus?: boolean } }>(
      "ssap://com.webos.service.ime/registerRemoteKeyboard",
    );
    return res.currentWidget?.focus === true;
  }

  /**
   * フォーカス中のテキストフィールドに文字列を入力する。
   * replace は boolean で送る必要がある（数値 0/1 だと TV が応答しない）。
   */
  async insertText(text: string, replace = false): Promise<void> {
    if (!(await this.isTextFieldFocused())) {
      throw new Error(
        "テキスト入力欄にフォーカスがありません。入力欄を選択して仮想キーボードを表示してください（アプリ独自のキーボードには入力できません）。",
      );
    }
    await this.client.request("ssap://com.webos.service.ime/insertText", { text, replace });
  }

  async deleteCharacters(count: number): Promise<void> {
    await this.client.request("ssap://com.webos.service.ime/deleteCharacters", { count });
  }

  async sendEnterKey(): Promise<void> {
    await this.client.request("ssap://com.webos.service.ime/sendEnterKey");
  }

  // ---- 設定 ----------------------------------------------------------------

  async getSettings(category: string, keys: string[]): Promise<Record<string, unknown>> {
    const res = await this.client.request<{ settings: Record<string, unknown> }>("ssap://settings/getSystemSettings", {
      category,
      keys,
    });
    return res.settings ?? {};
  }

  async setSettings(category: string, settings: Record<string, unknown>): Promise<void> {
    await this.client.request("ssap://settings/setSystemSettings", { category, settings });
  }

  async getSoundOutput(): Promise<string> {
    const res = await this.client.request<{ soundOutput: string }>("ssap://audio/getSoundOutput");
    return res.soundOutput;
  }

  async setSoundOutput(output: string): Promise<void> {
    await this.client.request("ssap://audio/changeSoundOutput", { output });
  }

  // ---- メディア再生 ---------------------------------------------------------

  async mediaControl(action: "play" | "pause" | "stop" | "rewind" | "fastForward"): Promise<void> {
    await this.client.request(`ssap://media.controls/${action}`);
  }

  // ---- 画面キャプチャ ------------------------------------------------------

  /**
   * 画面のスクリーンショット (960x540 JPEG) を取得する。
   * 解像度・形式のパラメータは TV 側で無視される。DRM 保護された映像は黒くなる。
   */
  async captureScreen(): Promise<Buffer> {
    const { imageUri } = await this.client.request<{ imageUri: string }>("ssap://tv/executeOneShot");
    return new Promise((resolve, reject) => {
      https
        .get(imageUri, { rejectUnauthorized: false, timeout: 10_000 }, (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`キャプチャ画像の取得に失敗: HTTP ${res.statusCode}`));
            return;
          }
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve(Buffer.concat(chunks)));
          res.on("error", reject);
        })
        .on("error", reject);
    });
  }

  // ---- キー / 電源 / その他 ----------------------------------------------

  async sendKeys(keys: string[]): Promise<void> {
    await this.client.sendButtons(keys);
  }

  /**
   * マウスポインタを相対移動する。1 回の move は 500px 程度までにし、大きい移動は分割する。
   * 画面左上へ寄せたい場合は大きな負の値を複数回送る。
   */
  async mouseMove(dx: number, dy: number, drag = false): Promise<void> {
    const messages: string[] = [];
    const step = 400;
    let rx = dx;
    let ry = dy;
    while (Math.abs(rx) > 0 || Math.abs(ry) > 0) {
      const sx = Math.max(-step, Math.min(step, rx));
      const sy = Math.max(-step, Math.min(step, ry));
      messages.push(`type:move\ndx:${sx}\ndy:${sy}\ndown:${drag ? 1 : 0}\n\n`);
      rx -= sx;
      ry -= sy;
    }
    if (messages.length) await this.client.sendPointerMessages(messages, 60);
  }

  async mouseClick(): Promise<void> {
    await this.client.sendPointerMessages(["type:click\n\n"]);
  }

  async mouseScroll(dx: number, dy: number): Promise<void> {
    await this.client.sendPointerMessages([`type:scroll\ndx:${dx}\ndy:${dy}\n\n`]);
  }

  async powerOff(): Promise<void> {
    await this.client.request("ssap://system/turnOff");
  }

  async showToast(message: string): Promise<void> {
    await this.client.request("ssap://system.notifications/createToast", { message });
  }

  async getSystemInfo(): Promise<Record<string, unknown>> {
    return this.client.request("ssap://system/getSystemInfo");
  }

  async getSoftwareInfo(): Promise<Record<string, unknown>> {
    return this.client.request("ssap://com.webos.service.update/getCurrentSWInformation");
  }
}

/** "2026,09,19,01,01,00" 形式を ISO 8601 (ローカル時刻) に変換する */
function toIsoLocal(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const p = v.split(",").map((x) => x.trim());
  if (p.length < 5) return v;
  return `${p[0]}-${p[1]}-${p[2]}T${p[3]}:${p[4]}:${p[5] ?? "00"}`;
}

function toProgram(p: Record<string, unknown>): ProgramInfo {
  return {
    programId: p.programId ? String(p.programId) : undefined,
    name: String(p.programName ?? ""),
    description: p.description ? String(p.description) : undefined,
    startTime: toIsoLocal(p.localStartTime ?? p.startTime),
    endTime: toIsoLocal(p.localEndTime ?? p.endTime),
    durationSec: typeof p.duration === "number" ? p.duration : undefined,
    genre: p.genre ? String(p.genre) : undefined,
    rating: p.rating ? String(p.rating) : undefined,
  };
}

/** send_key で受け付けるボタン名（TV 側の networkinput が解釈する名前）。 */
export const KEY_NAMES = [
  "LEFT",
  "RIGHT",
  "UP",
  "DOWN",
  "ENTER",
  "BACK",
  "EXIT",
  "HOME",
  "MENU",
  "INFO",
  "GUIDE",
  "DASH",
  "VOLUMEUP",
  "VOLUMEDOWN",
  "MUTE",
  "CHANNELUP",
  "CHANNELDOWN",
  "PLAY",
  "PAUSE",
  "STOP",
  "REWIND",
  "FASTFORWARD",
  "RECORD",
  "RED",
  "GREEN",
  "YELLOW",
  "BLUE",
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "ASTERISK",
  "CC",
  "POWER",
  "CLICK",
] as const;
export type KeyName = (typeof KEY_NAMES)[number];
