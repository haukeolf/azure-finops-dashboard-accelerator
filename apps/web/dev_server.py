from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os

REPO_ROOT = Path(__file__).resolve().parents[2]
WEB_ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("PORT", "5173"))


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        if path.startswith("/data/"):
            return str(REPO_ROOT / path.lstrip("/"))
        return str(WEB_ROOT / ("index.html" if path == "/" else path.lstrip("/")))


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Web dashboard: http://127.0.0.1:{PORT}")
    server.serve_forever()

