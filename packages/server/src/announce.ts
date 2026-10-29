/** The first line `--announce-json` prints (main.ts, appMain.ts): one JSON object, nothing else on the line. */
export function announceLine(running: { port: number; token: string; url: string }): string {
  return JSON.stringify({ port: running.port, token: running.token, url: running.url });
}
