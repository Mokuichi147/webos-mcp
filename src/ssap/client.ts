import WebSocket from "ws";
import { EventEmitter } from "node:events";
import { BLACKLISTED_CERT_ERROR, buildRegisterPayload } from "./manifest.js";
import { log } from "../log.js";

export interface SsapClientOptions {
  host: string;
  clientKey?: string;
  /** ペアリング承認待ちを含む登録タイムアウト (ms) */
  registerTimeoutMs?: number;
  /** 通常リクエストのタイムアウト (ms) */
  requestTimeoutMs?: number;
}

interface Pending {
  resolve: (payload: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

interface SsapMessage {
  type: "response" | "registered" | "error" | "hello";
  id?: string;
  payload?: Record<string, unknown>;
  error?: string;
}

export class SsapError extends Error {
  constructor(
    message: string,
    readonly uri?: string,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = "SsapError";
  }
}

/**
 * webOS TV の SSAP (Second Screen Application Protocol) WebSocket クライアント。
 *
 * - wss://host:3001 を優先し、失敗したら ws://host:3000 にフォールバックする。
 * - register で得た client-key は `clientKey` に保持する（呼び出し側で永続化する）。
 */
export class SsapClient extends EventEmitter {
  readonly host: string;
  clientKey?: string;
  private ws?: WebSocket;
  private seq = 0;
  private pending = new Map<string, Pending>();
  private registered = false;
  /** TV が署名付きマニフェストを拒否した場合 true（以後は署名なしで登録する） */
  private useUnsignedManifest = false;
  private readonly registerTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private connecting?: Promise<void>;

  constructor(opts: SsapClientOptions) {
    super();
    this.host = opts.host;
    this.clientKey = opts.clientKey;
    this.registerTimeoutMs = opts.registerTimeoutMs ?? 60_000;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 10_000;
  }

  get isConnected(): boolean {
    return this.registered && this.ws?.readyState === WebSocket.OPEN;
  }

  get isConnecting(): boolean {
    return this.connecting !== undefined;
  }

  /** 接続して登録（ペアリング）まで完了させる。すでに接続済みなら何もしない。 */
  async connect(): Promise<void> {
    if (this.isConnected) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.doConnect().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  private async doConnect(): Promise<void> {
    const candidates = [`wss://${this.host}:3001`, `ws://${this.host}:3000`];
    let lastErr: unknown;
    for (const url of candidates) {
      try {
        this.ws = await this.openSocket(url);
        log.debug("connected", url);
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = err;
        log.debug("connect failed", url, err);
      }
    }
    if (!this.ws) {
      throw new SsapError(`TV に接続できません (${this.host}): ${String(lastErr)}`);
    }
    await this.register();
  }

  private openSocket(url: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, {
        rejectUnauthorized: false,
        handshakeTimeout: 5000,
      });
      const onError = (err: Error) => {
        ws.removeAllListeners();
        reject(err);
      };
      ws.once("error", onError);
      ws.once("open", () => {
        ws.off("error", onError);
        ws.on("message", (data) => this.onMessage(data.toString()));
        ws.on("close", (code, reason) => this.onClose(code, reason.toString()));
        ws.on("error", (err) => log.debug("ws error", err));
        resolve(ws);
      });
    });
  }

  private async register(): Promise<void> {
    let result: { "client-key"?: string } | undefined;
    try {
      result = await this.sendRegister(!this.useUnsignedManifest);
    } catch (err) {
      if (this.useUnsignedManifest || !(err instanceof SsapError) || !err.message.includes(BLACKLISTED_CERT_ERROR)) {
        throw err;
      }
      log.debug("signed manifest rejected; retrying unsigned", this.host);
      this.useUnsignedManifest = true;
      result = await this.sendRegister(false);
    }
    const key = result?.["client-key"];
    if (typeof key === "string" && key.length > 0) {
      const changed = key !== this.clientKey;
      this.clientKey = key;
      if (changed) this.emit("clientKey", key);
    }
    this.registered = true;
    log.debug("registered", this.host);
  }

  private async sendRegister(signed: boolean): Promise<{ "client-key"?: string } | undefined> {
    const payload = buildRegisterPayload(this.clientKey, { signed });
    return (await this.send("register", undefined, payload, this.registerTimeoutMs)) as
      { "client-key"?: string } | undefined;
  }

  /** ssap:// URI にリクエストを送り、レスポンスの payload を返す。 */
  async request<T = Record<string, unknown>>(uri: string, payload?: Record<string, unknown>): Promise<T> {
    await this.connect();
    const result = (await this.send("request", uri, payload, this.requestTimeoutMs)) as Record<string, unknown>;
    if (result && result.returnValue === false) {
      const msg = (result.errorText as string) ?? (result.errorCode as string) ?? "unknown error";
      throw new SsapError(`${uri}: ${msg}`, uri, result);
    }
    return result as T;
  }

  /**
   * subscribe を送って最初の応答だけ受け取り、すぐに unsubscribe する。
   * registerRemoteKeyboard のように request では 500 になる URI の現在値取得に使う。
   */
  async subscribeOnce<T = Record<string, unknown>>(uri: string, payload?: Record<string, unknown>): Promise<T> {
    await this.connect();
    const id = `subscribe_${++this.seq}`;
    try {
      const result = (await this.send("subscribe", uri, payload, this.requestTimeoutMs, id)) as Record<string, unknown>;
      if (result && result.returnValue === false) {
        throw new SsapError(`${uri}: ${String(result.errorText ?? result.errorCode ?? "unknown error")}`, uri, result);
      }
      return result as T;
    } finally {
      this.ws?.send(JSON.stringify({ type: "unsubscribe", id }), () => {});
    }
  }

  private send(
    type: "register" | "request" | "subscribe",
    uri: string | undefined,
    payload: Record<string, unknown> | undefined,
    timeoutMs: number,
    id: string = `${type}_${++this.seq}`,
  ): Promise<unknown> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new SsapError("WebSocket が開いていません"));
    }
    const msg: Record<string, unknown> = { type, id };
    if (uri) msg.uri = uri;
    if (payload) msg.payload = payload;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new SsapError(`タイムアウト: ${uri ?? type}`, uri));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify(msg), (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  private onMessage(raw: string): void {
    let msg: SsapMessage;
    try {
      msg = JSON.parse(raw) as SsapMessage;
    } catch {
      log.debug("non-JSON message", raw);
      return;
    }
    log.debug("<-", raw.length > 500 ? raw.slice(0, 500) + "…" : raw);

    if (msg.type === "hello") return;
    if (!msg.id) return;
    const p = this.pending.get(msg.id);
    if (!p) return;

    if (msg.type === "response") {
      // 登録要求に対する「TV でプロンプト表示中」通知。registered を待ち続ける。
      if (msg.id.startsWith("register_") && msg.payload?.pairingType === "PROMPT") {
        this.emit("prompt");
        return;
      }
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      p.resolve(msg.payload);
    } else if (msg.type === "registered") {
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      p.resolve(msg.payload);
    } else if (msg.type === "error") {
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      p.reject(new SsapError(msg.error ?? "SSAP error", undefined, msg.payload));
    }
  }

  private onClose(code: number, reason: string): void {
    log.debug("closed", this.host, code, reason);
    this.registered = false;
    this.ws = undefined;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new SsapError(`接続が閉じられました (${code} ${reason})`));
      this.pending.delete(id);
    }
    this.emit("close");
  }

  close(): void {
    this.registered = false;
    try {
      this.ws?.close();
    } catch {
      /* noop */
    }
    this.ws = undefined;
  }

  /**
   * リモコンキー送信用のポインタ入力ソケットを開き、ボタンを送って閉じる。
   */
  async sendButtons(names: string[], intervalMs = 150): Promise<void> {
    await this.sendPointerMessages(
      names.map((n) => `type:button\nname:${n}\n\n`),
      intervalMs,
    );
  }

  /**
   * ポインタ入力ソケットに生メッセージ列を送る。
   * 形式は "type:move\ndx:10\ndy:0\ndown:0\n\n" のような改行区切りのキー:値。
   */
  async sendPointerMessages(messages: string[], intervalMs = 120): Promise<void> {
    const { socketPath } = await this.request<{ socketPath: string }>(
      "ssap://com.webos.service.networkinput/getPointerInputSocket",
    );
    const sock = await new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(socketPath, { rejectUnauthorized: false, handshakeTimeout: 5000 });
      ws.once("open", () => resolve(ws));
      ws.once("error", reject);
    });
    try {
      for (let i = 0; i < messages.length; i++) {
        await new Promise<void>((resolve, reject) => sock.send(messages[i], (err) => (err ? reject(err) : resolve())));
        if (i < messages.length - 1) await new Promise((r) => setTimeout(r, intervalMs));
      }
      // 送信が TV に届く前に閉じないよう少し待つ
      await new Promise((r) => setTimeout(r, 100));
    } finally {
      sock.close();
    }
  }
}
