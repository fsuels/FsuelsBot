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

    def do_POST(self):
        auth = self._check_auth()
        if auth == "redirect":
            return
        if not auth:
            self.send_response(403)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error": "Access denied"}')
            return

        path = self.path.split('?')[0]
        
        if path == '/api/delete-cron':
            # Read request body
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body) if body else {}
            except:
                data = {}
            
            cron_id = data.get('cronId')
            if not cron_id:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "cronId required"}).encode())
                return
            
            # Load tasks.json
            tasks_file = os.path.join(WORKSPACE_DIR, "memory", "tasks.json")
            try:
                with open(tasks_file, 'r', encoding='utf-8') as f:
                    tasks_data = json.load(f)
                
                scheduled = tasks_data.get('lanes', {}).get('scheduled', [])
                
                if cron_id not in scheduled:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": f"{cron_id} not in scheduled"}).encode())
                    return
                
                # Remove from scheduled lane
                scheduled.remove(cron_id)
                tasks_data['lanes']['scheduled'] = scheduled
                
                # Move to trash
                if 'trash' not in tasks_data['lanes']:
                    tasks_data['lanes']['trash'] = []
                tasks_data['lanes']['trash'].append(cron_id)
                
                # Mark with deletion info
                if cron_id in tasks_data.get('tasks', {}):
                    tasks_data['tasks'][cron_id]['status'] = 'trashed'
                    tasks_data['tasks'][cron_id]['deleted_at'] = datetime.now(timezone.utc).isoformat()
                    tasks_data['tasks'][cron_id]['deleted_from'] = 'scheduled'
                
                tasks_data['updated_at'] = datetime.now(timezone.utc).isoformat()
                
                # Write back
                with open(tasks_file, 'w', encoding='utf-8') as f:
                    json.dump(tasks_data, f, indent=4, ensure_ascii=False)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "message": f"Moved {cron_id} to trash",
                    "cronId": cron_id
                }).encode())
                return
                
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
                return
        
        if path == '/api/restore-task':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body) if body else {}
            except:
                data = {}
            
            task_id = data.get('taskId')
            if not task_id:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "taskId required"}).encode())
                return
            
            tasks_file = os.path.join(WORKSPACE_DIR, "memory", "tasks.json")
            try:
                with open(tasks_file, 'r', encoding='utf-8') as f:
                    tasks_data = json.load(f)
                
                trash = tasks_data.get('lanes', {}).get('trash', [])
                if task_id not in trash:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": f"{task_id} not in trash"}).encode())
                    return
                
                # Get original lane or default to bot_queue
                task = tasks_data.get('tasks', {}).get(task_id, {})
                restore_to = task.get('deleted_from', 'bot_queue')
                if restore_to == 'done_today':
                    restore_to = 'bot_queue'  # Don't restore to done
                
                # Remove from trash
                trash.remove(task_id)
                tasks_data['lanes']['trash'] = trash
                
                # Add to restore lane
                if restore_to not in tasks_data['lanes']:
                    tasks_data['lanes'][restore_to] = []
                tasks_data['lanes'][restore_to].append(task_id)
                
                # Update task status
                if task_id in tasks_data.get('tasks', {}):
                    tasks_data['tasks'][task_id]['status'] = 'pending'
                    del tasks_data['tasks'][task_id]['deleted_at']
                    if 'deleted_from' in tasks_data['tasks'][task_id]:
                        del tasks_data['tasks'][task_id]['deleted_from']
                
                tasks_data['updated_at'] = datetime.now(timezone.utc).isoformat()
                
                with open(tasks_file, 'w', encoding='utf-8') as f:
                    json.dump(tasks_data, f, indent=4, ensure_ascii=False)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "message": f"Restored {task_id}",
                    "restoredTo": restore_to
                }).encode())
                return
                
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
                return
        
        if path == '/api/permanent-delete':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body) if body else {}
            except:
                data = {}
            
            task_id = data.get('taskId')
            if not task_id:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "taskId required"}).encode())
                return
            
            tasks_file = os.path.join(WORKSPACE_DIR, "memory", "tasks.json")
            try:
                with open(tasks_file, 'r', encoding='utf-8') as f:
                    tasks_data = json.load(f)
                
                trash = tasks_data.get('lanes', {}).get('trash', [])
                if task_id not in trash:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": f"{task_id} not in trash"}).encode())
                    return
                
                # Remove from trash
                trash.remove(task_id)
                tasks_data['lanes']['trash'] = trash
                
                # Remove task entirely
                if task_id in tasks_data.get('tasks', {}):
                    del tasks_data['tasks'][task_id]
                
                tasks_data['updated_at'] = datetime.now(timezone.utc).isoformat()
                
                with open(tasks_file, 'w', encoding='utf-8') as f:
                    json.dump(tasks_data, f, indent=4, ensure_ascii=False)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "message": f"Permanently deleted {task_id}"
                }).encode())
                return
                
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
                return
        
        if path == '/api/read-file':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body) if body else {}
            except:
                data = {}
            
            file_path = data.get('path')
            if not file_path:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "path required"}).encode())
                return
            
            # Security: only allow reading from workspace
            full_path = os.path.join(WORKSPACE_DIR, file_path)
            full_path = os.path.normpath(full_path)
            
            if not full_path.startswith(WORKSPACE_DIR):
                self.send_response(403)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Access denied - path outside workspace"}).encode())
                return
            
            try:
                if os.path.exists(full_path):
                    with open(full_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                    
                    # Limit size for safety
                    if len(content) > 50000:
                        content = content[:50000] + '\n\n... [truncated - file too large]'
                    
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        "success": True,
                        "content": content,
                        "path": file_path
                    }).encode())
                else:
                    self.send_response(404)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": f"File not found: {file_path}"}).encode())
                return
                
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
                return
        
        if path == '/api/update-cron':
            # Read request body
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body) if body else {}
            except:
                data = {}
            
            cron_id = data.get('cronId')
            if not cron_id:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "cronId required"}).encode())
                return
            
            # Load tasks.json
            tasks_file = os.path.join(WORKSPACE_DIR, "memory", "tasks.json")
            try:
                with open(tasks_file, 'r', encoding='utf-8') as f:
                    tasks_data = json.load(f)
                
                if cron_id not in tasks_data.get('tasks', {}):
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": f"{cron_id} not found"}).encode())
                    return
                
                # Update cron fields
                cron = tasks_data['tasks'][cron_id]
                if 'schedule' in data:
                    cron['schedule'] = data['schedule']
                if 'plan' in data:
                    cron['plan'] = data['plan']
                if 'nextRun' in data:
                    cron['nextRun'] = data['nextRun']
                
                tasks_data['updated_at'] = datetime.now(timezone.utc).isoformat()
                
                # Write back
                with open(tasks_file, 'w', encoding='utf-8') as f:
                    json.dump(tasks_data, f, indent=4, ensure_ascii=False)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "message": f"Updated {cron_id}",
                    "cronId": cron_id
                }).encode())
                return
                
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
                return
        
        if path == '/api/transfer-task':
            # Read request body
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body) if body else {}
            except:
                data = {}
            
            task_id = data.get('taskId')
            from_lane = data.get('fromLane')
            to_lane = data.get('toLane')
            
            if not task_id or not from_lane or not to_lane:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "taskId, fromLane, and toLane required"}).encode())
                return
            
            # Load tasks.json
            tasks_file = os.path.join(WORKSPACE_DIR, "memory", "tasks.json")
            try:
                with open(tasks_file, 'r', encoding='utf-8') as f:
                    tasks_data = json.load(f)
                
                from_list = tasks_data.get('lanes', {}).get(from_lane, [])
                to_list = tasks_data.get('lanes', {}).get(to_lane, [])
                
                if task_id not in from_list:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": f"{task_id} not in {from_lane}"}).encode())
                    return
                
                # Move task
                from_list.remove(task_id)
                to_list.append(task_id)
                
                tasks_data['lanes'][from_lane] = from_list
                tasks_data['lanes'][to_lane] = to_list
                tasks_data['updated_at'] = datetime.now(timezone.utc).isoformat()
                
                # Write back
                with open(tasks_file, 'w', encoding='utf-8') as f:
                    json.dump(tasks_data, f, indent=4, ensure_ascii=False)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "message": f"Moved {task_id} from {from_lane} to {to_lane}",
                    "taskId": task_id
                }).encode())
                return
                
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
                return
        
        if path == '/api/delete-task':
            # Read request body
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body) if body else {}
            except:
                data = {}
            
            task_id = data.get('taskId')
            if not task_id:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "taskId required"}).encode())
                return
            
            # Load tasks.json
            tasks_file = os.path.join(WORKSPACE_DIR, "memory", "tasks.json")
            try:
                with open(tasks_file, 'r', encoding='utf-8') as f:
                    tasks_data = json.load(f)
                
                # Remove from all lanes
                removed_from = None
                for lane_name in ['bot_current', 'bot_queue', 'human', 'done_today']:
                    lane = tasks_data.get('lanes', {}).get(lane_name, [])
                    if task_id in lane:
                        lane.remove(task_id)
                        tasks_data['lanes'][lane_name] = lane
                        removed_from = lane_name
                        break
                
                if not removed_from:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": f"{task_id} not found in any lane"}).encode())
                    return
                
                # Move to trash lane
                if 'trash' not in tasks_data['lanes']:
                    tasks_data['lanes']['trash'] = []
                tasks_data['lanes']['trash'].append(task_id)
                
                # Mark task with deletion info
                if task_id in tasks_data.get('tasks', {}):
                    tasks_data['tasks'][task_id]['status'] = 'trashed'
                    tasks_data['tasks'][task_id]['deleted_at'] = datetime.now(timezone.utc).isoformat()
                    tasks_data['tasks'][task_id]['deleted_from'] = removed_from
                
                tasks_data['updated_at'] = datetime.now(timezone.utc).isoformat()
                
                # Write back
                with open(tasks_file, 'w', encoding='utf-8') as f:
                    json.dump(tasks_data, f, indent=4, ensure_ascii=False)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "message": f"Moved {task_id} to trash",
                    "taskId": task_id
                }).encode())
                return
                
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
                return
        
        if path == '/api/reorder-task':
            # Read request body
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body) if body else {}
            except:
                data = {}
            
            task_id = data.get('taskId')
            direction = data.get('direction')  # 'up' or 'down'
            
            if not task_id or direction not in ('up', 'down'):
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "taskId and direction (up/down) required"}).encode())
                return
            
            # Load tasks.json
            tasks_file = os.path.join(WORKSPACE_DIR, "memory", "tasks.json")
            try:
                with open(tasks_file, 'r', encoding='utf-8') as f:
                    tasks_data = json.load(f)
                
                bot_queue = tasks_data.get('lanes', {}).get('bot_queue', [])
                
                if task_id not in bot_queue:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": f"{task_id} not in bot_queue"}).encode())
                    return
                
                idx = bot_queue.index(task_id)
                
                if direction == 'up' and idx > 0:
                    # Swap with previous
                    bot_queue[idx], bot_queue[idx-1] = bot_queue[idx-1], bot_queue[idx]
                elif direction == 'down' and idx < len(bot_queue) - 1:
                    # Swap with next
                    bot_queue[idx], bot_queue[idx+1] = bot_queue[idx+1], bot_queue[idx]
                else:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": f"Cannot move {direction} from position {idx}"}).encode())
                    return
                
                tasks_data['lanes']['bot_queue'] = bot_queue
                tasks_data['updated_at'] = datetime.now(timezone.utc).isoformat()
                
                # Write back
                with open(tasks_file, 'w', encoding='utf-8') as f:
                    json.dump(tasks_data, f, indent=4, ensure_ascii=False)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "message": f"Moved {task_id} {direction}",
                    "newOrder": bot_queue
                }).encode())
                return
                
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
                return
        
        if path == '/api/request-complete':
            # Read request body
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body) if body else {}
            except:
                data = {}
            
            task_id = data.get('taskId')
            if not task_id:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "taskId required"}).encode())
                return
            
            # Load tasks.json
            tasks_file = os.path.join(WORKSPACE_DIR, "memory", "tasks.json")
            try:
                with open(tasks_file, 'r', encoding='utf-8') as f:
                    tasks_data = json.load(f)
                
                human_lane = tasks_data.get('lanes', {}).get('human', [])
                bot_current = tasks_data.get('lanes', {}).get('bot_current', [])
                done_today = tasks_data.get('lanes', {}).get('done_today', [])
                
                # Check if this is a Council task (human verifies bot work → goes to done)
                task_data = tasks_data.get('tasks', {}).get(task_id, {})
                is_council = task_data.get('title', '').lower().startswith('council')
                
                # Council tasks: human clicked "Verify Bot Work" → move to done_today
                if is_council and task_id in human_lane:
                    human_lane.remove(task_id)
                    done_today.insert(0, task_id)
                    task_data['status'] = 'done'
                    task_data['completed_at'] = datetime.now(timezone.utc).isoformat()
                    task_data['verified_by'] = 'human'
                    tasks_data['tasks'][task_id] = task_data
                    tasks_data['lanes']['human'] = human_lane
                    tasks_data['lanes']['done_today'] = done_today
                    tasks_data['updated_at'] = datetime.now(timezone.utc).isoformat()
                    
                    with open(tasks_file, 'w', encoding='utf-8') as f:
                        json.dump(tasks_data, f, indent=4, ensure_ascii=False)
                    
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        "success": True,
                        "message": f"Council {task_id} verified and marked complete!",
                        "taskId": task_id
                    }).encode())
                    return
                
                # ALL tasks: human verification is FINAL - move directly to done_today
                if task_id not in human_lane:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": f"{task_id} not in human lane"}).encode())
                    return
                
                # Remove from human, add to done_today
                human_lane.remove(task_id)
                done_today.insert(0, task_id)
                
                # Mark task as done (human verified)
                if task_id in tasks_data.get('tasks', {}):
                    tasks_data['tasks'][task_id]['status'] = 'done'
                    tasks_data['tasks'][task_id]['completed_at'] = datetime.now(timezone.utc).isoformat()
                    tasks_data['tasks'][task_id]['verified_by'] = 'human'
                
                tasks_data['lanes']['human'] = human_lane
                tasks_data['lanes']['done_today'] = done_today
                tasks_data['updated_at'] = datetime.now(timezone.utc).isoformat()
                
                # Write back
                with open(tasks_file, 'w', encoding='utf-8') as f:
                    json.dump(tasks_data, f, indent=4, ensure_ascii=False)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "message": f"{task_id} marked complete!",
                    "taskId": task_id
                }).encode())
                return
                
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
                return
        
        if path == '/api/task-comment':
            # Add comment to task's discussion array
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body) if body else {}
            except:
                data = {}
            
            task_id = data.get('taskId')
            message = data.get('message', '').strip()
            
            if not task_id or not message:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "taskId and message required"}).encode())
                return
            
            tasks_file = os.path.join(WORKSPACE_DIR, "memory", "tasks.json")
            try:
                with open(tasks_file, 'r', encoding='utf-8') as f:
                    tasks_data = json.load(f)
                
                task_data = tasks_data.get('tasks', {}).get(task_id)
                if not task_data:
                    self.send_response(404)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": f"Task {task_id} not found"}).encode())
                    return
                
                # Initialize discussion array if not exists
                if 'discussion' not in task_data:
                    task_data['discussion'] = []
                
                # Add the comment
                comment = {
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "author": "human",
                    "message": message
                }
                task_data['discussion'].append(comment)
                
                # Update task and version
                tasks_data['tasks'][task_id] = task_data
                tasks_data['version'] = tasks_data.get('version', 0) + 1
                tasks_data['updated_at'] = datetime.now(timezone.utc).isoformat()
                
                with open(tasks_file, 'w', encoding='utf-8') as f:
                    json.dump(tasks_data, f, indent=4, ensure_ascii=False)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "message": "Comment added",
                    "taskId": task_id
                }).encode())
                return
                
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
                return
        
        if path == '/api/toggle-crossout':
            # Toggle crossed_out status on a discussion comment
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body) if body else {}
            except:
                data = {}
            
            task_id = data.get('taskId')
            comment_idx = data.get('commentIdx')
            
            if not task_id or comment_idx is None:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "taskId and commentIdx required"}).encode())
                return
            
            tasks_file = os.path.join(WORKSPACE_DIR, "memory", "tasks.json")
            try:
                with open(tasks_file, 'r', encoding='utf-8') as f:
                    tasks_data = json.load(f)
                
                task_data = tasks_data.get('tasks', {}).get(task_id)
                if not task_data:
                    self.send_response(404)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": f"Task {task_id} not found"}).encode())
                    return
                
                discussion = task_data.get('discussion', [])
                if comment_idx < 0 or comment_idx >= len(discussion):
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": "Invalid comment index"}).encode())
                    return
                
                # Toggle crossed_out status
                current = discussion[comment_idx].get('crossed_out', False)
                discussion[comment_idx]['crossed_out'] = not current
                
                # Update task and version
                task_data['discussion'] = discussion
                tasks_data['tasks'][task_id] = task_data
                tasks_data['version'] = tasks_data.get('version', 0) + 1
                tasks_data['updated_at'] = datetime.now(timezone.utc).isoformat()
                
                with open(tasks_file, 'w', encoding='utf-8') as f:
                    json.dump(tasks_data, f, indent=4, ensure_ascii=False)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "crossed_out": not current,
                    "taskId": task_id,
                    "commentIdx": comment_idx
                }).encode())
                return
                
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
                return
        
        if path == '/api/score-prediction':
            # Score a prediction as correct (✓) or wrong (✗)
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body) if body else {}
            except:
                data = {}
            
            pred_id = data.get('id')
            score = data.get('score')  # 1-5 numeric rating
            
            # Convert to int if needed
            try:
                score = int(score)
            except:
                pass
            
            if not pred_id or score not in [1, 2, 3, 4, 5]:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Missing id or invalid score"}).encode())
                return
            
            predictions_file = os.path.join(DASHBOARD_DIR, "predictions.json")
            try:
                with open(predictions_file, 'r', encoding='utf-8') as f:
                    preds = json.load(f)
                
                # Find and update the prediction
                found = False
                for p in preds.get('predictions', []):
                    if p.get('id') == pred_id:
                        old_score = p.get('score')
                        p['score'] = score
                        p['scored_at'] = datetime.now(timezone.utc).isoformat()
                        found = True
                        
                        # Update stats
                        if old_score is None:
                            preds['stats']['pending'] -= 1
                        elif old_score >= 4:
                            preds['stats']['correct'] -= 1
                        else:
                            preds['stats']['wrong'] -= 1
                        
                        if score >= 4:  # 4-5 = correct
                            preds['stats']['correct'] += 1
                        else:  # 1-3 = needs improvement
                            preds['stats']['wrong'] += 1
                        break
                
                if not found:
                    self.send_response(404)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": f"Prediction {pred_id} not found"}).encode())
                    return
                
                preds['version'] += 1
                with open(predictions_file, 'w', encoding='utf-8') as f:
                    json.dump(preds, f, indent=4)
                
                # Update game stats
                today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                game = preds.get('game', {"streak": 0, "best_streak": 0, "today_scored": 0, "total_scored": 0, "accuracy": 0, "last_play_date": None, "level": 1, "xp": 0})
                
                if game.get('last_play_date') != today:
                    # New day - check streak
                    if game.get('last_play_date'):
                        from datetime import timedelta
                        last = datetime.strptime(game['last_play_date'], "%Y-%m-%d")
                        if (datetime.strptime(today, "%Y-%m-%d") - last).days == 1:
                            game['streak'] += 1
                        else:
                            game['streak'] = 1
                    else:
                        game['streak'] = 1
                    game['today_scored'] = 0
                    game['last_play_date'] = today
                
                game['today_scored'] += 1
                game['total_scored'] += 1
                game['xp'] += score * 2  # XP based on score: 2-10 points
                game['best_streak'] = max(game['streak'], game.get('best_streak', 0))
                
                # Calculate accuracy
                total = preds['stats']['correct'] + preds['stats']['wrong']
                game['accuracy'] = round(preds['stats']['correct'] / total * 100) if total > 0 else 0
                
                # Level up every 100 XP
                game['level'] = 1 + game['xp'] // 100
                
                preds['game'] = game
                
                # Log to daily predictions log
                log_file = os.path.join(WORKSPACE_DIR, "memory", "predictions-log.jsonl")
                log_entry = {
                    "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                    "time": datetime.now(timezone.utc).strftime("%H:%M:%S"),
                    "event": "score",
                    "prediction_id": pred_id,
                    "score": score,
                    "stats": preds['stats'],
                    "game": game
                }
                with open(log_file, 'a', encoding='utf-8') as f:
                    f.write(json.dumps(log_entry) + '\n')
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True, "id": pred_id, "score": score, "stats": preds['stats']}).encode())
                return
                
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
                return

        self.send_response(404)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"error": "Not found"}')

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
        
        if path == '/api/predictions-history':
            # Return predictions scoring history
            log_file = os.path.join(WORKSPACE_DIR, "memory", "predictions-log.jsonl")
            try:
                entries = []
                if os.path.exists(log_file):
                    with open(log_file, 'r', encoding='utf-8') as f:
                        for line in f:
                            line = line.strip()
                            if line:
                                entries.append(json.loads(line))
                # Return most recent first
                entries.reverse()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Cache-Control', 'no-cache')
                self.end_headers()
                self.wfile.write(json.dumps({"entries": entries}).encode())
                return
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
                return

        if path == '/api/predictions':
            # Return predictions for reinforcement learning display
            predictions_file = os.path.join(DASHBOARD_DIR, "predictions.json")
            try:
                with open(predictions_file, 'r', encoding='utf-8') as f:
                    preds = json.load(f)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Cache-Control', 'no-cache')
                self.end_headers()
                self.wfile.write(json.dumps(preds).encode())
                return
            except FileNotFoundError:
                self.send_response(404)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"error": "predictions.json not found"}')
                return
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
                return

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
                    
                    # AUTO-PROMOTE: If bot_current is empty, pull from bot_queue
                    lanes = tasks_data.get('lanes', {})
                    bot_current = lanes.get('bot_current', [])
                    bot_queue = lanes.get('bot_queue', [])
                    
                    if len(bot_current) == 0 and len(bot_queue) > 0:
                        # Move first task from queue to current
                        next_task_id = bot_queue.pop(0)
                        bot_current.append(next_task_id)
                        
                        # Update task status
                        if next_task_id in tasks_data.get('tasks', {}):
                            tasks_data['tasks'][next_task_id]['status'] = 'in_progress'
                            tasks_data['tasks'][next_task_id]['started_at'] = datetime.now(timezone.utc).isoformat()
                        
                        # Save back to file
                        lanes['bot_current'] = bot_current
                        lanes['bot_queue'] = bot_queue
                        tasks_data['lanes'] = lanes
                        tasks_data['updated_at'] = datetime.now(timezone.utc).isoformat()
                        
                        with open(tasks_file, 'w', encoding='utf-8') as f:
                            json.dump(tasks_data, f, indent=4, ensure_ascii=False)
                    
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
