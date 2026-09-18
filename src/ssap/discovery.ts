import dgram from "node:dgram";
import { log } from "../log.js";

export interface DiscoveredDevice {
  host: string;
  id?: string;
  friendlyName?: string;
  model?: string;
  location?: string;
}

const SSDP_ADDR = "239.255.255.250";
const SSDP_PORT = 1900;
const SEARCH_TARGET = "urn:lge-com:service:webos-second-screen:1";

function parseHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split(/\r?\n/).slice(1)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return headers;
}

function xmlTag(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m?.[1]?.trim();
}

async function fetchDescription(location: string, timeoutMs: number): Promise<Partial<DiscoveredDevice>> {
  try {
    const res = await fetch(location, { signal: AbortSignal.timeout(timeoutMs) });
    const xml = await res.text();
    return {
      friendlyName: xmlTag(xml, "friendlyName"),
      // modelName は "LG Smart TV" 固定のことが多いので modelNumber を優先する
      model: xmlTag(xml, "modelNumber")?.split(".")[0] || xmlTag(xml, "modelName"),
      id: xmlTag(xml, "UDN")?.replace(/^uuid:/, ""),
    };
  } catch (err) {
    log.debug("description fetch failed", location, err);
    return {};
  }
}

/**
 * SSDP M-SEARCH で LAN 上の webOS TV を探索する。
 */
export async function discoverDevices(timeoutMs = 3000): Promise<DiscoveredDevice[]> {
  const found = new Map<string, DiscoveredDevice>();
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

  const message = Buffer.from(
    [
      "M-SEARCH * HTTP/1.1",
      `HOST: ${SSDP_ADDR}:${SSDP_PORT}`,
      'MAN: "ssdp:discover"',
      "MX: 2",
      `ST: ${SEARCH_TARGET}`,
      "",
      "",
    ].join("\r\n"),
  );

  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.on("message", (msg, rinfo) => {
      const headers = parseHeaders(msg.toString("utf8"));
      const st = headers["st"] ?? headers["nt"] ?? "";
      if (!st.includes("webos") && !(headers["server"] ?? "").toLowerCase().includes("webos")) return;
      if (!found.has(rinfo.address)) {
        found.set(rinfo.address, {
          host: rinfo.address,
          location: headers["location"],
          id: headers["usn"]?.match(/uuid:([^:]+)/)?.[1],
        });
      }
    });
    socket.bind(0, () => {
      try {
        socket.setBroadcast(true);
        socket.setMulticastTTL(2);
      } catch (err) {
        log.debug("socket option failed", err);
      }
      // 取りこぼし対策で複数回送る
      for (const delay of [0, 500, 1000]) {
        setTimeout(() => {
          socket.send(message, 0, message.length, SSDP_PORT, SSDP_ADDR, (err) => {
            if (err) log.debug("M-SEARCH send failed", err);
          });
        }, delay);
      }
      setTimeout(resolve, timeoutMs);
    });
  }).finally(() => {
    try {
      socket.close();
    } catch {
      /* noop */
    }
  });

  const results = await Promise.all(
    [...found.values()].map(async (dev) => {
      if (!dev.location) return dev;
      const desc = await fetchDescription(dev.location, 2000);
      return { ...dev, ...Object.fromEntries(Object.entries(desc).filter(([, v]) => v !== undefined)) };
    }),
  );
  return results;
}
