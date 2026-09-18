import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DeviceManager } from "../devices.js";
import { registerDeviceTools } from "./devices.js";
import { registerAppTools } from "./apps.js";
import { registerAudioTools } from "./audio.js";
import { registerInputTools } from "./input.js";
import { registerSystemTools } from "./system.js";
import { registerTvTools } from "./tv.js";

export function registerAllTools(server: McpServer, manager: DeviceManager): void {
  registerDeviceTools(server, manager);
  registerAppTools(server, manager);
  registerAudioTools(server, manager);
  registerInputTools(server, manager);
  registerSystemTools(server, manager);
  registerTvTools(server, manager);
}
