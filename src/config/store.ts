import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface DeviceRecord {
  /** 表示名（識別子としても使う） */
  name: string;
  /** TV の IP アドレスまたはホスト名 */
  host: string;
  /** SSDP で取得した UDN 等の ID */
  id?: string;
  /** ペアリング済みの client-key */
  clientKey?: string;
  /** モデル名（表示用） */
  model?: string;
  /** Wake-on-LAN 用 MAC アドレス（有線） */
  mac?: string;
  /** Wake-on-LAN 用 MAC アドレス（無線） */
  wifiMac?: string;
}

export interface DevicesFile {
  version: 1;
  defaultDevice?: string;
  devices: Record<string, DeviceRecord>;
}

const EMPTY: DevicesFile = { version: 1, devices: {} };

export function defaultConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), ".config");
  return path.join(base, "webos-mcp");
}

export class DeviceStore {
  readonly filePath: string;

  constructor(configDir: string = defaultConfigDir()) {
    this.filePath = path.join(configDir, "devices.json");
  }

  async load(): Promise<DevicesFile> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<DevicesFile>;
      return {
        version: 1,
        defaultDevice: parsed.defaultDevice,
        devices: parsed.devices ?? {},
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { ...EMPTY, devices: {} };
      }
      throw err;
    }
  }

  async save(data: DevicesFile): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }

  async list(): Promise<DeviceRecord[]> {
    const data = await this.load();
    return Object.values(data.devices);
  }

  async get(name: string): Promise<DeviceRecord | undefined> {
    const data = await this.load();
    return data.devices[name];
  }

  /** name で一致する既存レコードにマージして保存する */
  async upsert(record: DeviceRecord, opts: { makeDefault?: boolean } = {}): Promise<DeviceRecord> {
    const data = await this.load();
    const merged: DeviceRecord = { ...data.devices[record.name], ...record };
    data.devices[record.name] = merged;
    if (opts.makeDefault || !data.defaultDevice) {
      data.defaultDevice = record.name;
    }
    await this.save(data);
    return merged;
  }

  async remove(name: string): Promise<boolean> {
    const data = await this.load();
    if (!data.devices[name]) return false;
    delete data.devices[name];
    if (data.defaultDevice === name) {
      data.defaultDevice = Object.keys(data.devices)[0];
    }
    await this.save(data);
    return true;
  }

  async setDefault(name: string): Promise<void> {
    const data = await this.load();
    if (!data.devices[name]) throw new Error(`device not found: ${name}`);
    data.defaultDevice = name;
    await this.save(data);
  }
}
