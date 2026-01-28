"""Mission Control Server — serves dashboard + Clawdbot status proxy
Security: requires ?key= token on first visit, sets cookie for session."""
import http.server
import json
import urllib.request
import os
import time
import socketserver
import secrets
import http.cookies

PORT = 8765
GATEWAY_URL = "http://127.0.0.1:18789"
GATEWAY_TOKEN = os.environ.get("CLAWDBOT_GATEWAY_TOKEN", "")
DASHBOARD_KEY = os.environ.get("DASHBOARD_KEY", "a6132abf77194fd10a77317a094771f1")
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

# Session tokens — valid cookies mapped to creation time
_valid_sessions = {}

class MissionControlHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def _check_auth(self):
        """Check ?key= param or session cookie. Returns True if authorized."""
        # Check query param
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        
        if params.get("key", [None])[0] == DASHBOARD_KEY:
            # Valid key — issue session cookie
            session_id = secrets.token_hex(16)
            _valid_sessions[session_id] = time.time()
            self.send_response(302)
            self.send_header("Set-Cookie", f"mc_session={session_id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400")
            # Redirect to clean URL (strip key from URL)
            clean_path = parsed.path or "/"
            self.send_header("Location", clean_path)
            self.end_headers()
            return "redirect"
        
        # Check cookie
        cookie_header = self.headers.get("Cookie", "")
        if cookie_header:
            cookies = http.cookies.SimpleCookie()
            try:
                cookies.load(cookie_header)
                session = cookies.get("mc_session")
                if session and session.value in _valid_sessions:
                    # Valid session — check if not expired (24h)
                    created = _valid_sessions[session.value]
                    if time.time() - created < 86400:
                        return True
                    else:
                        del _valid_sessions[session.value]
            except Exception:
                pass
        
        # Also allow localhost without auth
        client_ip = self.client_address[0]
        if client_ip in ("127.0.0.1", "::1"):
            return True
        
        return False

    def do_GET(self):
        auth = self._check_auth()
        if auth == "redirect":
            return
        if not auth:
            self.send_response(403)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"<h1>403 Forbidden</h1><p>Access denied. Use the correct URL with key.</p>")
            return
        
        from urllib.parse import urlparse
        parsed = urlparse(self.path)
        
        if parsed.path == '/api/status':
            self.handle_status()
        else:
            # Serve file from clean path (no query string confusion)
            self.path = parsed.path
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
                is_online = code == 200
                import re
                name_match = re.search(r'__CLAWDBOT_ASSISTANT_NAME__="([^"]+)"', body)
                name = name_match.group(1) if name_match else "Clawdbot"
                
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
    print(f"Dashboard key: {DASHBOARD_KEY}")
    print(f"Access URL: http://192.168.4.25:{PORT}?key={DASHBOARD_KEY}")
    with ReusableTCPServer(("0.0.0.0", PORT), MissionControlHandler) as httpd:
        import socket
        local_ip = socket.gethostbyname(socket.gethostname())
        print(f"Mission Control serving on:")
        print(f"  Local:   http://127.0.0.1:{PORT}  (no key needed)")
        print(f"  Network: http://{local_ip}:{PORT}?key={DASHBOARD_KEY}")
        httpd.serve_forever()
