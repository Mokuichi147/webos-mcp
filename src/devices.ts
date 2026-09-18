import { DeviceStore, type DeviceRecord } from "./config/store.js";
import { SsapClient, TvCommands, discoverDevices } from "./ssap/index.js";
import { log } from "./log.js";

export interface DeviceManagerOptions {
  store: DeviceStore;
  /** CLI / 環境変数で指定された既定デバイス名 */
  defaultDevice?: string;
  /** 設定ファイルを使わず直接指定されたデバイス */
  adHoc?: { host: string; clientKey?: string; name?: string };
}

export interface Connection {
  record: DeviceRecord;
  client: SsapClient;
  tv: TvCommands;
}

/**
 * デバイス設定の解決と SSAP 接続のキャッシュを担う。
 * MCP ツールからは「デバイス名（省略可）」だけで TV を扱えるようにする。
 */
export class DeviceManager {
  private readonly store: DeviceStore;
  private readonly defaultDevice?: string;
  private readonly adHoc?: DeviceRecord;
  private readonly connections = new Map<string, Connection>();

  constructor(opts: DeviceManagerOptions) {
    this.store = opts.store;
    this.defaultDevice = opts.defaultDevice;
    if (opts.adHoc) {
      this.adHoc = { name: opts.adHoc.name ?? opts.adHoc.host, host: opts.adHoc.host, clientKey: opts.adHoc.clientKey };
    }
  }

  get deviceStore(): DeviceStore {
    return this.store;
  }

  /** 名前 or ホスト名から DeviceRecord を解決する。 */
  async resolve(nameOrHost?: string): Promise<DeviceRecord> {
    const data = await this.store.load();
    const devices = Object.values(data.devices);
    if (this.adHoc) devices.push(this.adHoc);

    const wanted = nameOrHost ?? this.defaultDevice ?? this.adHoc?.name ?? data.defaultDevice;
    if (wanted) {
      const hit = devices.find((d) => d.name === wanted) ?? devices.find((d) => d.host === wanted);
      if (hit) return hit;
      // 未登録でもホスト名/IP らしければ ad-hoc で扱う（ペアリングは pair_device で行う）
      if (nameOrHost && /^[\w.\-:]+$/.test(nameOrHost) && nameOrHost.includes(".")) {
        return { name: nameOrHost, host: nameOrHost };
      }
      throw new Error(
        `デバイス "${wanted}" が見つかりません。discover_devices で探索し pair_device で登録してください。`,
      );
    }
    if (devices.length === 1) return devices[0];
    if (devices.length === 0) {
      throw new Error("登録済みデバイスがありません。discover_devices → pair_device で登録してください。");
    }
    throw new Error(
      `複数のデバイスが登録されています。device パラメータで指定してください: ${devices.map((d) => d.name).join(", ")}`,
    );
  }

  /** 接続（必要なら登録）済みの Connection を返す。 */
  async connect(nameOrHost?: string): Promise<Connection> {
    const record = await this.resolve(nameOrHost);
    const cached = this.connections.get(record.name);
    if (cached && (cached.client.isConnected || cached.client.isConnecting)) {
      // 並行呼び出し時は進行中の接続を待って共有する
      await cached.client.connect();
      return cached;
    }
    cached?.client.close();

    const client = new SsapClient({ host: record.host, clientKey: record.clientKey });
    client.on("clientKey", (key: string) => {
      record.clientKey = key;
      this.persistKey(record, key).catch((err) => log.error("client-key の保存に失敗", err));
    });
    client.on("close", () => {
      if (this.connections.get(record.name)?.client === client) this.connections.delete(record.name);
    });
    const conn: Connection = { record, client, tv: new TvCommands(client) };
    this.connections.set(record.name, conn);
    await client.connect();
    return conn;
  }

  private async persistKey(record: DeviceRecord, key: string): Promise<void> {
    if (this.adHoc && record.name === this.adHoc.name) {
      this.adHoc.clientKey = key;
      log.info(`client-key を取得しました（設定ファイルには保存しません）: ${key}`);
      return;
    }
    await this.store.upsert({ ...record, clientKey: key });
    log.debug("client-key saved", record.name);
  }

  /**
   * 新しいホストとペアリングし、設定へ保存する。
   * 表示名・モデル・ID は SSDP 探索結果で補完する（探索失敗時は host をそのまま使う）。
   */
  async pair(host: string, opts: { name?: string; makeDefault?: boolean } = {}): Promise<DeviceRecord> {
    const info = await discoverDevices(1500)
      .then((list) => list.find((d) => d.host === host))
      .catch(() => undefined);
    const name = opts.name ?? info?.friendlyName ?? host;
    const existing = (await this.store.get(name)) ?? { name, host };
    const record: DeviceRecord = {
      ...existing,
      host,
      id: info?.id ?? existing.id,
      model: info?.model ?? existing.model,
    };

    const client = new SsapClient({ host, clientKey: record.clientKey });
    try {
      await client.connect();
      // 電源 ON (Wake-on-LAN) 用に MAC アドレスも保存しておく
      const net = await new TvCommands(client).getNetworkInfo().catch(() => undefined);
      if (net?.wiredMac) record.mac = net.wiredMac;
      if (net?.wifiMac) record.wifiMac = net.wifiMac;
    } finally {
      client.close();
    }
    record.clientKey = client.clientKey;
    const saved = await this.store.upsert(record, { makeDefault: opts.makeDefault });
    this.connections.get(name)?.client.close();
    this.connections.delete(name);
    return saved;
  }

  closeAll(): void {
    for (const conn of this.connections.values()) conn.client.close();
    this.connections.clear();
  }
}
