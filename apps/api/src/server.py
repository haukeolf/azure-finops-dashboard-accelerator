from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import os

REPO_ROOT = Path(__file__).resolve().parents[3]
SNAPSHOT_PATH = Path(os.environ.get("DASHBOARD_SNAPSHOT_PATH", REPO_ROOT / "data/snapshots/dashboard-snapshot.json"))
PORT = int(os.environ.get("PORT", "7071"))


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, status, payload):
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-methods", "GET, OPTIONS")
        self.send_header("access-control-allow-headers", "content-type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-methods", "GET, OPTIONS")
        self.send_header("access-control-allow-headers", "content-type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/api/health":
            self._send_json(200, {"ok": True})
            return

        if self.path == "/api/dashboard":
            try:
                self._send_json(200, json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8")))
            except Exception as exc:
                self._send_json(500, {"error": str(exc)})
            return

        self._send_json(404, {"error": "Not found"})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"API: http://127.0.0.1:{PORT}")
    server.serve_forever()

