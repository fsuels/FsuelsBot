"""Mission Control Server — serves dashboard + Clawdbot status proxy"""
import http.server
import json
import urllib.request
import os
import time
import socketserver

PORT = 8765
GATEWAY_URL = "http://127.0.0.1:18789"
GATEWAY_TOKEN = os.environ.get("CLAWDBOT_GATEWAY_TOKEN", "")
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class MissionControlHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        if self.path == '/api/status':
            self.handle_status()
        else:
            super().do_GET()

    def handle_status(self):
        try:
            req = urllib.request.Request(
                GATEWAY_URL,
                headers={"Authorization": f"Bearer {GATEWAY_TOKEN}"}
            )
            with urllib.request.urlopen(req, timeout=3) as resp:
                code = resp.getcode()
                body = resp.read().decode()[:500]
                # Gateway is alive if it responds at all
                is_online = code == 200
                # Extract assistant name from the HTML
                import re
                name_match = re.search(r'__CLAWDBOT_ASSISTANT_NAME__="([^"]+)"', body)
                name = name_match.group(1) if name_match else "Clawdbot"
                
                # Get process uptime
                uptime_secs = 0
                config_path = os.path.join(os.environ.get('USERPROFILE', ''), '.clawdbot', 'clawdbot.json')
                if os.path.isfile(config_path):
                    start_time = os.path.getmtime(config_path)
                    uptime_secs = int(time.time() - start_time)
                
                result = {
                    "online": is_online,
                    "timestamp": time.time(),
                    "name": name,
                    "uptime": uptime_secs,
                    "gatewayPort": 18789,
                    "gatewayUrl": "http://localhost:18789"
                }
        except Exception as e:
            result = {
                "online": False,
                "timestamp": time.time(),
                "error": str(e)
            }

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(result).encode())

    def log_message(self, format, *args):
        pass  # Suppress logs

class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

if __name__ == "__main__":
    if not GATEWAY_TOKEN:
        print("WARNING: CLAWDBOT_GATEWAY_TOKEN not set. Status proxy will fail.")
    with ReusableTCPServer(("0.0.0.0", PORT), MissionControlHandler) as httpd:
        import socket
        local_ip = socket.gethostbyname(socket.gethostname())
        print(f"Mission Control serving on:")
        print(f"  Local:   http://127.0.0.1:{PORT}")
        print(f"  Network: http://{local_ip}:{PORT}  (use this on your phone)")
        httpd.serve_forever()
