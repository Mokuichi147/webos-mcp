import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const deviceParam = z
  .string()
  .optional()
  .describe("対象デバイス名または IP。省略時は既定デバイス（--device / WEBOS_DEVICE / devices.json の defaultDevice）");

export function ok(text: string, structured?: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

export function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function fail(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** ハンドラの例外を isError レスポンスに変換する。 */
export function guarded<A>(fn: (args: A) => Promise<CallToolResult>): (args: A) => Promise<CallToolResult> {
  return async (args) => {
    try {
      return await fn(args);
    } catch (err) {
      return fail(err);
    }
  };
}
