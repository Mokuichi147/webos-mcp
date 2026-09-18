/**
 * stdout は MCP の stdio トランスポートが使うので、ログは必ず stderr へ出す。
 */
// CLI が --debug で環境変数を後から設定するため、都度評価する
const enabled = (): boolean => process.env.WEBOS_MCP_DEBUG === "1" || process.env.WEBOS_MCP_DEBUG === "true";

export const log = {
  debug(...args: unknown[]): void {
    if (enabled()) console.error("[webos-mcp]", ...args);
  },
  info(...args: unknown[]): void {
    console.error("[webos-mcp]", ...args);
  },
  error(...args: unknown[]): void {
    console.error("[webos-mcp] ERROR", ...args);
  },
};
