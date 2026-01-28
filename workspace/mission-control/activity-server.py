"""
Mission Control Activity Server
Serves dashboard + live activity feed from Clawdbot logs
"""
import http.server
import json
import os
import re
import time
import threading
from datetime import datetime, timezone, timedelta
from pathlib import Path

PORT = 8765
LOG_DIR = r"\tmp\clawdbot"
DASHBOARD_DIR = os.path.dirname(os.path.abspath(__file__))

# Shared state
activity_state = {
    "status": "idle",
    "statusSince": datetime.now(timezone.utc).isoformat(),
    "currentTask": None,
    "currentTool": None,
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
state_lock = threading.Lock()

def get_log_file():
    """Get today's log file path"""
    today = datetime.now().strftime("%Y-%m-%d")
    return os.path.join(LOG_DIR, f"clawdbot-{today}.log")

def parse_log_entry(line):
    """Parse a JSON log line into a structured event"""
    try:
        data = json.loads(line.strip())
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
        
        level = meta.get("logLevelName", "INFO")
        
        return {
            "time": timestamp,
            "subsystem": subsystem,
            "message": str(msg)[:200],
            "level": level
        }
    except:
        return None

def categorize_event(entry):
    """Categorize a log entry into activity type"""
    if not entry:
        return None
    
    msg = entry.get("message", "")
    sub = entry.get("subsystem", "")
    
    # Tool calls
    if "tool start" in msg:
        tool_match = re.search(r'tool=(\S+)', msg)
        tool = tool_match.group(1) if tool_match else "unknown"
        return {"type": "tool_start", "tool": tool, "icon": "🔧"}
    
    if "tool end" in msg or "tool done" in msg:
        tool_match = re.search(r'tool=(\S+)', msg)
        tool = tool_match.group(1) if tool_match else "unknown"
        return {"type": "tool_end", "tool": tool, "icon": "✅"}
    
    # Run lifecycle
    if "run start" in msg:
        model_match = re.search(r'model=(\S+)', msg)
        model = model_match.group(1) if model_match else ""
        return {"type": "run_start", "model": model, "icon": "🧠"}
    
    if "run end" in msg or "run done" in msg or "run complete" in msg:
        return {"type": "run_end", "icon": "🏁"}
    
    # Session state
    if "session state" in msg:
        state_match = re.search(r'new=(\S+)', msg)
        state = state_match.group(1) if state_match else ""
        return {"type": "session_state", "state": state, "icon": "📊"}
    
    # Prompt
    if "prompt start" in msg:
        return {"type": "prompt_start", "icon": "💬"}
    
    if "agent start" in msg:
        return {"type": "agent_start", "icon": "🤖"}
    
    # Errors
    if entry.get("level") == "ERROR" or "error" in msg.lower() or "Unhandled" in msg:
        return {"type": "error", "icon": "❌"}
    
    # WebSocket / connections
    if "connected" in msg and "ws" in sub:
        return {"type": "connection", "icon": "🔌"}
    
    # Telegram
    if "telegram" in sub.lower():
        return {"type": "telegram", "icon": "📱"}
    
    # Gateway
    if "gateway" in sub:
        return {"type": "gateway", "icon": "🌐"}
    
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
                            "message": entry["message"][:150],
                            "subsystem": entry["subsystem"]
                        }
                        
                        # Update state based on event type
                        if cat["type"] == "tool_start":
                            activity_state["status"] = "working"
                            activity_state["currentTool"] = cat.get("tool", "unknown")
                            tool_labels = {
                                "exec": "Running terminal command",
                                "browser": "Using web browser",
                                "Read": "Reading file",
                                "Write": "Writing file",
                                "Edit": "Editing file",
                                "web_search": "Searching the web",
                                "web_fetch": "Fetching web page",
                                "memory_search": "Searching memory",
                                "memory_get": "Reading memory",
                                "sessions_spawn": "Spawning sub-agent",
                                "sessions_send": "Messaging sub-agent",
                                "image": "Analyzing image",
                                "cron": "Managing scheduled task",
                                "message": "Sending message",
                                "gateway": "Gateway operation",
                                "tts": "Text to speech",
                                "canvas": "Rendering canvas"
                            }
                            activity_state["currentTask"] = tool_labels.get(
                                cat.get("tool"), f"Using {cat.get('tool', 'tool')}"
                            )
                            activity_state["stats"]["toolCalls"] += 1
                        
                        elif cat["type"] == "tool_end":
                            activity_state["currentTool"] = None
                        
                        elif cat["type"] == "run_start":
                            activity_state["status"] = "thinking"
                            activity_state["statusSince"] = entry["time"]
                            activity_state["currentTask"] = "Processing request..."
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
                            activity_state["currentTask"] = "Thinking..."
                        
                        elif cat["type"] == "agent_start":
                            activity_state["status"] = "working"
                            activity_state["currentTask"] = "Processing..."
                        
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
    
    def do_GET(self):
        # Strip query string for path matching
        path = self.path.split('?')[0]
        
        if path == '/api/activity':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            with state_lock:
                self.wfile.write(json.dumps(activity_state, indent=2).encode())
            return
        
        if path == '/api/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok", "time": datetime.now(timezone.utc).isoformat()}).encode())
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
