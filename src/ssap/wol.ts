import dgram from "node:dgram";

/** Wake-on-LAN のマジックパケットを送る。 */
export async function sendMagicPacket(mac: string, opts: { address?: string; port?: number } = {}): Promise<void> {
  const hex = mac.replace(/[^0-9a-fA-F]/g, "");
  if (hex.length !== 12) throw new Error(`MAC アドレスの形式が不正です: ${mac}`);
  const macBytes = Buffer.from(hex, "hex");
  const packet = Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => macBytes)]);
  const address = opts.address ?? "255.255.255.255";
  const port = opts.port ?? 9;

  const socket = dgram.createSocket("udp4");
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(0, () => {
        socket.setBroadcast(true);
        socket.send(packet, 0, packet.length, port, address, (err) => (err ? reject(err) : resolve()));
      });
    });
  } finally {
    socket.close();
  }
}
