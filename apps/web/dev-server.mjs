import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = new URL(".", import.meta.url).pathname;
const repoRoot = new URL("../../", import.meta.url).pathname;
const port = Number(process.env.PORT || 5173);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function resolvePath(urlPath) {
  if (urlPath.startsWith("/data/")) {
    return join(repoRoot, normalize(urlPath));
  }
  const path = urlPath === "/" ? "/index.html" : urlPath;
  return join(root, normalize(path));
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const file = resolvePath(url.pathname);
    const body = await readFile(file);
    res.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch (error) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end(`Not found: ${req.url}`);
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Web dashboard: http://127.0.0.1:${port}`);
});

