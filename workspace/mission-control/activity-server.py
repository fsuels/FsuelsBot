"""
Mission Control Activity Server
Serves dashboard + live activity feed from Clawdbot logs
"""
import http.server
import http.cookies
import json
import os
import re
import time
import secrets
import threading
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlparse, parse_qs

PORT = 8765
LOG_DIR = r"\tmp\clawdbot"
DASHBOARD_DIR = os.path.dirname(os.path.abspath(__file__))
DASHBOARD_KEY = os.environ.get("DASHBOARD_KEY", "a6132abf77194fd10a77317a094771f1")

# Session tokens for wifi auth
_valid_sessions = {}

# Shared state
activity_state = {
    "status": "idle",
    "statusSince": datetime.now(timezone.utc).isoformat(),
    "currentTask": None,
    "currentTool": None,
    "highLevelTask": None,
    "recentEvents": [],
    "sessionInfo": {
        "model": "claude-opus-4-5",
        "sessionId": None,
        "provider": "anthropic"
    },
    "stats": {
        "toolCalls": 0,
        "runsCompleted": 0,
        "errorsToday": 0,
        "lastError": None,
        "upSince": datetime.now(timezone.utc).isoformat()
    },
    "lastUpdate": datetime.now(timezone.utc).isoformat()
}

CURRENT_TASK_FILE = os.path.join(DASHBOARD_DIR, "current-task.json")
WORKSPACE_DIR = os.path.dirname(DASHBOARD_DIR)  # Parent of mission-control

def check_memory_health():
    """Check memory system integrity"""
    checks = {}
    errors = []
    warnings = []
    
    # Check state.json
    state_file = os.path.join(WORKSPACE_DIR, "memory", "state.json")
    if os.path.exists(state_file):
        try:
            with open(state_file, 'r', encoding='utf-8') as f:
                state = json.load(f)
            checks["state.json"] = {"status": "ok", "version": state.get("version", "?")}
            # Extract current task info
            if state.get("currentTask"):
                checks["currentTask"] = {
                    "id": state["currentTask"].get("id"),
                    "description": state["currentTask"].get("description"),
                    "status": state["currentTask"].get("status"),
                    "progress": state["currentTask"].get("progress", {})
                }
        except Exception as e:
            checks["state.json"] = {"status": "error", "error": str(e)}
            errors.append("state.json invalid")
    else:
        checks["state.json"] = {"status": "missing"}
        errors.append("state.json missing")
    
    # Check events.jsonl
    events_file = os.path.join(WORKSPACE_DIR, "memory", "events.jsonl")
    if os.path.exists(events_file):
        try:
            with open(events_file, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            checks["events.jsonl"] = {"status": "ok", "count": len(lines)}
        except Exception as e:
            checks["events.jsonl"] = {"status": "error", "error": str(e)}
            errors.append("events.jsonl unreadable")
    else:
        checks["events.jsonl"] = {"status": "missing"}
        warnings.append("events.jsonl not created yet")
    
    # Check active-thread.md
    thread_file = os.path.join(WORKSPACE_DIR, "memory", "active-thread.md")
    if os.path.exists(thread_file):
        mtime = os.path.getmtime(thread_file)
        age_min = (time.time() - mtime) / 60
        checks["active-thread.md"] = {"status": "ok", "ageMinutes": round(age_min, 1)}
    else:
        checks["active-thread.md"] = {"status": "missing"}
        errors.append("active-thread.md missing")
    
    # Check CONSTITUTION.md
    const_file = os.path.join(WORKSPACE_DIR, "CONSTITUTION.md")
    checks["CONSTITUTION.md"] = {"status": "ok" if os.path.exists(const_file) else "missing"}
    if not os.path.exists(const_file):
        errors.append("CONSTITUTION.md missing")
    
    # Check AGENTS.md has CURRENT STATE
    agents_file = os.path.join(WORKSPACE_DIR, "AGENTS.md")
    if os.path.exists(agents_file):
        with open(agents_file, 'r', encoding='utf-8') as f:
            content = f.read()
        if "CURRENT STATE" in content:
            checks["AGENTS.md"] = {"status": "ok", "hasState": True}
        else:
            checks["AGENTS.md"] = {"status": "warning", "hasState": False}
            warnings.append("AGENTS.md missing CURRENT STATE section")
    else:
        checks["AGENTS.md"] = {"status": "missing"}
        errors.append("AGENTS.md missing")
    
    # Check today's memory file
    today = datetime.now().strftime("%Y-%m-%d")
    today_file = os.path.join(WORKSPACE_DIR, "memory", f"{today}.md")
    checks["todayLog"] = {"status": "ok" if os.path.exists(today_file) else "pending", "date": today}
    
    # Overall health
    if errors:
        overall = "error"
    elif warnings:
        overall = "warning"
    else:
        overall = "healthy"
    
    return {
        "overall": overall,
        "checks": checks,
        "errors": errors,
        "warnings": warnings,
        "checkedAt": datetime.now(timezone.utc).isoformat()
    }

def load_current_task():
    """Load current task from state.json (authoritative) with fallback to current-task.json"""
    # Try state.json first (authoritative source)
    state_file = os.path.join(WORKSPACE_DIR, "memory", "state.json")
    try:
        if os.path.exists(state_file):
            with open(state_file, 'r', encoding='utf-8') as f:
                state = json.load(f)
            if state.get("currentTask"):
                task = state["currentTask"]
                progress = task.get("progress", {})
                completed = progress.get("completed", [])
                remaining = progress.get("remaining", [])
                total = len(completed) + len(remaining)
                pct = round(len(completed) / total * 100) if total else 0
                
                # Build steps list
                steps = []
                for item in completed:
                    steps.append({"label": item, "done": True})
                for item in remaining:
                    steps.append({"label": item, "done": False})
                
                return {
                    "orchestrator": {
                        "name": "Fsuels Bot",
                        "emoji": "🤖",
                        "model": "claude-opus-4.5",
                        "status": "complete" if task.get("status") == "✅ COMPLETE" else "working",
                        "task": task.get("description", "Working..."),
                        "project": task.get("id", ""),
                        "description": task.get("context", ""),
                        "progress": pct,
                        "steps": steps,
                        "benefit": task.get("nextStep", ""),
                        "lastHeartbeat": state.get("lastUpdated", "")
                    }
                }
    except Exception as e:
        print(f"Error loading state.json: {e}")
    
    # Fallback to current-task.json
    try:
        if os.path.exists(CURRENT_TASK_FILE):
            mtime = os.path.getmtime(CURRENT_TASK_FILE)
            if time.time() - mtime < 1800:
                with open(CURRENT_TASK_FILE, 'r', encoding='utf-8') as f:
                    return json.load(f)
    except:
        pass
    return None
state_lock = threading.Lock()

def get_log_file():
    """Get today's log file path"""
    today = datetime.now().strftime("%Y-%m-%d")
    return os.path.join(LOG_DIR, f"clawdbot-{today}.log")

def strip_ansi(text):
    """Remove ANSI escape codes from text"""
    return re.sub(r'\x1b\[[0-9;]*m', '', text)

def parse_log_entry(line):
    """Parse a JSON log line into a structured event"""
    try:
        clean_line = strip_ansi(line.strip())
        data = json.loads(clean_line)
        meta = data.get("_meta", {})
        timestamp = data.get("time", meta.get("date", ""))
        subsystem_raw = meta.get("name", "")
        
        # Extract subsystem name
        subsystem = ""
        try:
            sub_parsed = json.loads(subsystem_raw)
            subsystem = sub_parsed.get("subsystem", "")
        except:
            subsystem = subsystem_raw
        
        # Get the main message (key "1" or "0")
        msg = data.get("1", data.get("0", ""))
        if isinstance(msg, dict):
            msg = json.dumps(msg)
        
        msg = strip_ansi(str(msg))
        level = meta.get("logLevelName", "INFO")
        
        return {
            "time": timestamp,
            "subsystem": subsystem,
            "message": msg[:200],
            "level": level
        }
    except:
        return None

def categorize_event(entry):
    """Categorize a log entry into activity type with human-readable descriptions"""
    if not entry:
        return None
    
    msg = entry.get("message", "")
    sub = entry.get("subsystem", "")
    
    # Human-readable tool descriptions
    tool_descriptions = {
        "exec": ("💻", "Running a terminal command"),
        "browser": ("🌐", "Working in the web browser"),
        "Read": ("📖", "Reading a file"),
        "Write": ("✏️", "Writing a file"),
        "Edit": ("📝", "Editing a file"),
        "web_search": ("🔍", "Searching the web"),
        "web_fetch": ("📥", "Fetching a web page"),
        "memory_search": ("🧠", "Searching memory"),
        "memory_get": ("🧠", "Retrieving memory"),
        "sessions_spawn": ("🤖", "Starting a sub-agent"),
        "sessions_send": ("💬", "Messaging a sub-agent"),
        "sessions_list": ("📋", "Checking active sessions"),
        "sessions_history": ("📜", "Reading session history"),
        "image": ("🖼️", "Analyzing an image"),
        "cron": ("⏰", "Managing a scheduled task"),
        "message": ("📨", "Sending a message"),
        "gateway": ("⚙️", "Gateway operation"),
        "tts": ("🔊", "Converting text to speech"),
        "canvas": ("🎨", "Rendering a visual"),
        "session_status": ("📊", "Checking session status"),
    }
    
    # Tool calls
    if "tool start" in msg:
        tool_match = re.search(r'tool=(\S+)', msg)
        tool = tool_match.group(1) if tool_match else "unknown"
        icon, desc = tool_descriptions.get(tool, ("🔧", f"Using {tool}"))
        return {"type": "tool_start", "tool": tool, "icon": icon, "friendly": desc}
    
    if "tool end" in msg or "tool done" in msg:
        tool_match = re.search(r'tool=(\S+)', msg)
        tool = tool_match.group(1) if tool_match else "unknown"
        icon, desc = tool_descriptions.get(tool, ("✅", f"Finished {tool}"))
        return {"type": "tool_end", "tool": tool, "icon": "✅", "friendly": f"Done: {desc.lower()}"}
    
    # Run lifecycle
    if "run start" in msg:
        model_match = re.search(r'model=(\S+)', msg)
        model = model_match.group(1) if model_match else ""
        channel_match = re.search(r'messageChannel=(\S+)', msg)
        channel = channel_match.group(1) if channel_match else ""
        friendly = "Processing a new request"
        if channel:
            friendly += f" from {channel.title()}"
        return {"type": "run_start", "model": model, "icon": "🧠", "friendly": friendly}
    
    if "run end" in msg or "run done" in msg or "run complete" in msg:
        return {"type": "run_end", "icon": "🏁", "friendly": "Finished processing request"}
    
    # Session state
    if "session state" in msg:
        state_match = re.search(r'new=(\S+)', msg)
        state = state_match.group(1) if state_match else ""
        if state == "processing":
            return {"type": "session_state", "state": state, "icon": "⚡", "friendly": "Started working"}
        elif state == "idle":
            return {"type": "session_state", "state": state, "icon": "💤", "friendly": "Now idle — waiting for next task"}
        return {"type": "session_state", "state": state, "icon": "📊", "friendly": f"Session state: {state}"}
    
    # Prompt
    if "prompt start" in msg:
        return {"type": "prompt_start", "icon": "💭", "friendly": "Thinking about how to respond..."}
    
    if "agent start" in msg:
        return {"type": "agent_start", "icon": "🤖", "friendly": "AI agent activated"}
    
    # Errors
    if entry.get("level") == "ERROR" or "Unhandled" in msg:
        # Clean up error messages for humans
        friendly = msg
        if "fetch failed" in msg:
            friendly = "Network request failed — connection issue"
        elif "timeout" in msg.lower():
            friendly = "Operation timed out"
        elif "ECONNREFUSED" in msg:
            friendly = "Connection refused — service may be down"
        elif "tab not found" in msg:
            friendly = "Browser tab was closed — reopening"
        elif "Unknown ref" in msg:
            friendly = "Browser page changed — refreshing view"
        elif "browser failed" in msg:
            friendly = "Browser action failed — retrying"
        elif "[tools]" in msg:
            # Extract just the tool name and simplify
            tool_match = re.search(r'\[tools\]\s*(\S+)\s*failed', msg)
            if tool_match:
                friendly = f"{tool_match.group(1).title()} operation failed — retrying"
            else:
                friendly = "Tool operation failed — retrying"
        return {"type": "error", "icon": "⚠️", "friendly": friendly[:120]}
    
    # WebSocket / connections
    if "connected" in msg and "ws" in sub:
        client_match = re.search(r'client=(\S+)', msg)
        client = client_match.group(1) if client_match else "unknown"
        return {"type": "connection", "icon": "🔌", "friendly": f"New connection: {client}"}
    
    # Telegram
    if "telegram" in sub.lower():
        if "message" in msg.lower() or "send" in msg.lower():
            return {"type": "telegram", "icon": "📱", "friendly": "Telegram message activity"}
        return None  # Skip noisy telegram events
    
    return None

def tail_log():
    """Background thread that tails the log file"""
    global activity_state
    
    current_file = None
    file_handle = None
    file_pos = 0
    
    while True:
        try:
            log_file = get_log_file()
            
            # Handle log file rotation
            if log_file != current_file:
                if file_handle:
                    file_handle.close()
                current_file = log_file
                if os.path.exists(log_file):
                    file_handle = open(log_file, 'r', encoding='utf-8', errors='replace')
                    # Start from near end for existing files
                    file_handle.seek(0, 2)  # End of file
                    size = file_handle.tell()
                    # Read last 50KB for initial state
                    start_pos = max(0, size - 50000)
                    file_handle.seek(start_pos)
                    if start_pos > 0:
                        file_handle.readline()  # Skip partial line
                    file_pos = file_handle.tell()
                else:
                    file_handle = None
                    time.sleep(5)
                    continue
            
            if not file_handle:
                time.sleep(5)
                continue
            
            # Read new lines
            new_lines = file_handle.readlines()
            
            if new_lines:
                with state_lock:
                    for line in new_lines:
                        entry = parse_log_entry(line)
                        if not entry:
                            continue
                        
                        cat = categorize_event(entry)
                        if not cat:
                            continue
                        
                        event = {
                            "time": entry["time"],
                            "type": cat["type"],
                            "icon": cat["icon"],
                            "message": cat.get("friendly", entry["message"][:150]),
                            "subsystem": entry["subsystem"]
                        }
                        
                        # Update state based on event type
                        if cat["type"] == "tool_start":
                            activity_state["status"] = "working"
                            activity_state["currentTool"] = cat.get("tool", "unknown")
                            activity_state["currentTask"] = cat.get("friendly", f"Using {cat.get('tool', 'tool')}")
                            activity_state["stats"]["toolCalls"] += 1
                        
                        elif cat["type"] == "tool_end":
                            activity_state["currentTool"] = None
                        
                        elif cat["type"] == "run_start":
                            activity_state["status"] = "thinking"
                            activity_state["statusSince"] = entry["time"]
                            activity_state["currentTask"] = cat.get("friendly", "Processing request...")
                            if cat.get("model"):
                                activity_state["sessionInfo"]["model"] = cat["model"]
                        
                        elif cat["type"] == "run_end":
                            activity_state["status"] = "idle"
                            activity_state["statusSince"] = entry["time"]
                            activity_state["currentTask"] = None
                            activity_state["currentTool"] = None
                            activity_state["stats"]["runsCompleted"] += 1
                        
                        elif cat["type"] == "session_state":
                            state = cat.get("state", "")
                            if state == "processing":
                                activity_state["status"] = "working"
                            elif state == "idle":
                                activity_state["status"] = "idle"
                                activity_state["currentTask"] = None
                                activity_state["currentTool"] = None
                        
                        elif cat["type"] == "prompt_start":
                            activity_state["status"] = "thinking"
                            activity_state["currentTask"] = cat.get("friendly", "Thinking...")
                        
                        elif cat["type"] == "agent_start":
                            activity_state["status"] = "working"
                            activity_state["currentTask"] = cat.get("friendly", "Processing...")
                        
                        elif cat["type"] == "error":
                            activity_state["stats"]["errorsToday"] += 1
                            activity_state["stats"]["lastError"] = entry["message"][:100]
                        
                        # Add to recent events (keep last 50)
                        activity_state["recentEvents"].insert(0, event)
                        activity_state["recentEvents"] = activity_state["recentEvents"][:50]
                    
                    activity_state["lastUpdate"] = datetime.now(timezone.utc).isoformat()
        
        except Exception as e:
            print(f"Log tail error: {e}")
            if file_handle:
                try:
                    file_handle.close()
                except:
                    pass
                file_handle = None
                current_file = None
        
        time.sleep(2)  # Poll every 2 seconds


class ActivityHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DASHBOARD_DIR, **kwargs)

    def _check_auth(self):
        """Check ?key= param or session cookie. Returns True, False, or 'redirect'."""
        # Localhost always allowed
        client_ip = self.client_address[0]
        if client_ip in ("127.0.0.1", "::1"):
            return True

        # Check query param for key
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        if params.get("key", [None])[0] == DASHBOARD_KEY:
            session_id = secrets.token_hex(16)
            _valid_sessions[session_id] = time.time()
            self.send_response(302)
            self.send_header("Set-Cookie", f"mc_session={session_id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400")
            self.send_header("Location", parsed.path or "/")
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
                    if time.time() - _valid_sessions[session.value] < 86400:
                        return True
                    else:
                        del _valid_sessions[session.value]
            except Exception:
                pass

        return False

    def do_GET(self):
        auth = self._check_auth()
        if auth == "redirect":
            return
        if not auth:
            self.send_response(403)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"<h1>403 Forbidden</h1><p>Access denied.</p>")
            return

        # Strip query string for path matching
        path = self.path.split('?')[0]
        
        if path == '/api/activity':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            with state_lock:
                response = dict(activity_state)
                response["highLevelTask"] = load_current_task()
                self.wfile.write(json.dumps(response, indent=2, ensure_ascii=False).encode('utf-8'))
            return
        
        if path == '/api/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok", "time": datetime.now(timezone.utc).isoformat()}).encode())
            return
        
        if path == '/api/memory':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            memory_health = check_memory_health()
            self.wfile.write(json.dumps(memory_health, indent=2, ensure_ascii=False).encode('utf-8'))
            return
        
        if path == '/api/backlog':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            backlog = []
            state_file = os.path.join(WORKSPACE_DIR, "memory", "state.json")
            try:
                if os.path.exists(state_file):
                    with open(state_file, 'r', encoding='utf-8') as f:
                        state = json.load(f)
                    backlog = state.get("backlog", [])
            except Exception as e:
                print(f"Error loading backlog: {e}")
            self.wfile.write(json.dumps({"backlog": backlog}, indent=2, ensure_ascii=False).encode('utf-8'))
            return
        
        if path == '/api/tasks':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            tasks_file = os.path.join(WORKSPACE_DIR, "memory", "tasks.json")
            try:
                if os.path.exists(tasks_file):
                    with open(tasks_file, 'r', encoding='utf-8') as f:
                        tasks_data = json.load(f)
                    self.wfile.write(json.dumps(tasks_data, indent=2, ensure_ascii=False).encode('utf-8'))
                else:
                    self.wfile.write(json.dumps({"error": "tasks.json not found"}).encode('utf-8'))
            except Exception as e:
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
            return
        
        if path == '/api/metrics':
            # Council A+ upgrade: Metrics dashboard endpoint
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            try:
                import subprocess
                result = subprocess.run(
                    ['python', os.path.join(WORKSPACE_DIR, 'scripts', 'metrics.py'), 'status'],
                    capture_output=True, text=True, timeout=5
                )
                if result.returncode == 0:
                    self.wfile.write(result.stdout.encode('utf-8'))
                else:
                    self.wfile.write(json.dumps({"error": result.stderr or "metrics.py failed"}).encode('utf-8'))
            except Exception as e:
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
            return
        
        if path == '/api/circuits':
            # Council A+ upgrade: Circuit breaker status
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            circuits_file = os.path.join(WORKSPACE_DIR, "memory", "circuits.json")
            try:
                if os.path.exists(circuits_file):
                    with open(circuits_file, 'r', encoding='utf-8') as f:
                        self.wfile.write(f.read().encode('utf-8'))
                else:
                    self.wfile.write(json.dumps({"error": "circuits.json not found"}).encode('utf-8'))
            except Exception as e:
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
            return
        
        if path == '/api/status':
            # Return status based on log activity (no gateway proxy - it returns HTML)
            up_since = activity_state.get("stats", {}).get("upSince", "")
            uptime = 0
            if up_since:
                try:
                    up_dt = datetime.fromisoformat(up_since)
                    uptime = int((datetime.now(timezone.utc) - up_dt).total_seconds())
                except:
                    pass
            # Check if we've seen activity recently (within 5 min = online)
            last_update = activity_state.get("lastUpdate", "")
            online = False
            if last_update:
                try:
                    last_dt = datetime.fromisoformat(last_update)
                    online = (datetime.now(timezone.utc) - last_dt).total_seconds() < 300
                except:
                    pass
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({
                "online": online,
                "uptime": uptime,
                "status": activity_state.get("status", "unknown")
            }).encode())
            return
        
        # Serve static files
        return super().do_GET()
    
    def log_message(self, format, *args):
        pass  # Suppress request logging


def main():
    import sys
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)
    
    # Start log tailer thread
    tailer = threading.Thread(target=tail_log, daemon=True)
    tailer.start()
    print(f"Activity server starting on port {PORT}")
    print(f"Dashboard: http://localhost:{PORT}")
    print(f"Activity API: http://localhost:{PORT}/api/activity")
    print(f"LAN: http://192.168.4.25:{PORT}")
    
    server = http.server.HTTPServer(('0.0.0.0', PORT), ActivityHandler)
    server.allow_reuse_address = True
    print("Server bound and listening...")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == '__main__':
    main()
