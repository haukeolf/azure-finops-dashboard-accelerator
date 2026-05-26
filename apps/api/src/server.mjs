import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const repoRoot = new URL("../../../", import.meta.url).pathname;
const snapshotPath = process.env.DASHBOARD_SNAPSHOT_PATH ||
  join(repoRoot, "data/snapshots/dashboard-snapshot.json");
const port = Number(process.env.PORT || 7071);

async function readSnapshot() {
  const body = await readFile(snapshotPath, "utf8");
  return JSON.parse(body);
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === "/api/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname === "/api/dashboard") {
    try {
      const snapshot = await readSnapshot();
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      });
      res.end(JSON.stringify(snapshot));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "Not found" }));
}).listen(port, "127.0.0.1", () => {
  console.log(`API: http://127.0.0.1:${port}`);
});

