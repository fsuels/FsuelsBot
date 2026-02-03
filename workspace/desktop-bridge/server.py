import json
import os
import secrets
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

import mss
import pyautogui

WORKSPACE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TOKEN_PATH = os.path.join(WORKSPACE, "memory", ".desktop-bridge-token")
HOST = "127.0.0.1"
PORT = int(os.environ.get("DESKTOP_BRIDGE_PORT", "18888"))

state = {
    "control_enabled": False
}
state_lock = threading.Lock()


def get_or_create_token():
    os.makedirs(os.path.dirname(TOKEN_PATH), exist_ok=True)
    if os.path.exists(TOKEN_PATH):
        t = open(TOKEN_PATH, "r", encoding="utf-8").read().strip()
        if t:
            return t
    t = secrets.token_hex(24)
    with open(TOKEN_PATH, "w", encoding="utf-8") as f:
        f.write(t)
    return t


def require_token(handler):
    token = handler.headers.get("X-Desktop-Token")
    if not token or token.strip() != get_or_create_token():
        handler.send_response(401)
        handler.send_header("Content-Type", "application/json")
        handler.end_headers()
        handler.wfile.write(json.dumps({"error": "unauthorized"}).encode("utf-8"))
        return False
    return True


def send_json(handler, code, obj):
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json")
    handler.end_headers()
    handler.wfile.write(json.dumps(obj).encode("utf-8"))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # quiet
        return

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        if path == "/health":
            with state_lock:
                ce = state["control_enabled"]
            return send_json(self, 200, {"ok": True, "control_enabled": ce, "port": PORT})

        if path == "/screen.png":
            if not require_token(self):
                return
            monitor = int(qs.get("monitor", ["1"])[0])
            with mss.mss() as sct:
                monitors = sct.monitors
                if monitor < 1 or monitor >= len(monitors):
                    monitor = 1
                img = sct.grab(monitors[monitor])
                png = mss.tools.to_png(img.rgb, img.size)

            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(png)
            return

        return send_json(self, 404, {"error": "not_found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(body.decode("utf-8"))
        except Exception:
            data = {}

        if path in ("/control/enable", "/control/disable"):
            if not require_token(self):
                return
            with state_lock:
                state["control_enabled"] = (path == "/control/enable")
                ce = state["control_enabled"]
            return send_json(self, 200, {"ok": True, "control_enabled": ce})

        if path == "/input":
            if not require_token(self):
                return
            with state_lock:
                if not state["control_enabled"]:
                    return send_json(self, 403, {"error": "control_disabled"})

            action = data.get("action")
            if action == "move":
                x = int(data.get("x"))
                y = int(data.get("y"))
                pyautogui.moveTo(x, y)
                return send_json(self, 200, {"ok": True})
            if action == "click":
                button = data.get("button", "left")
                pyautogui.click(button=button)
                return send_json(self, 200, {"ok": True})
            if action == "type":
                text = data.get("text", "")
                pyautogui.write(text, interval=0.01)
                return send_json(self, 200, {"ok": True})
            if action == "hotkey":
                keys = data.get("keys")
                if isinstance(keys, list) and keys:
                    pyautogui.hotkey(*keys)
                    return send_json(self, 200, {"ok": True})

            return send_json(self, 400, {"error": "unknown_action"})

        return send_json(self, 404, {"error": "not_found"})


def main():
    token = get_or_create_token()
    print(f"Desktop Bridge listening on http://{HOST}:{PORT}")
    print(f"Token file: {TOKEN_PATH}")
    print("Control enabled: False")
    httpd = HTTPServer((HOST, PORT), Handler)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
