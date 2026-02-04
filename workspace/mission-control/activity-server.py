"""
Mission Control Activity Server
Serves dashboard + live activity feed from Clawdbot logs
"""
import http.server
import http.cookies
import json
import os
import re
import shutil
import subprocess
import time
import secrets
import threading
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get("MISSION_CONTROL_PORT", "8765"))
LOG_DIR = r"\tmp\clawdbot"
DASHBOARD_DIR = os.path.dirname(os.path.abspath(__file__))
BIND_HOST = os.environ.get("DASHBOARD_BIND", "127.0.0.1")
DASHBOARD_KEY = os.environ.get("DASHBOARD_KEY", "").strip()
_generated_dashboard_key = False
if not DASHBOARD_KEY:
    DASHBOARD_KEY = secrets.token_hex(32)
    _generated_dashboard_key = True

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
WORKSPACE_PATH = Path(WORKSPACE_DIR).resolve()
CONFIG_CANDIDATES = [
    os.path.join(Path.home(), ".openclaw", "openclaw.json"),
    os.path.join(Path.home(), ".clawdbot", "clawdbot.json"),
    os.path.join(Path.home(), ".openclaw", "clawdbot.json"),
]
SESSION_STORE_CANDIDATES = [
    os.path.join(Path.home(), ".openclaw", "agents", "main", "sessions", "sessions.json"),
    os.path.join(Path.home(), ".clawdbot", "agents", "main", "sessions", "sessions.json"),
]
_runtime_session_cache = {"at": 0.0, "info": None}
_models_state_cache = {"at": 0.0, "data": None, "error": None}
_models_cache_lock = threading.Lock()
_models_refreshing = False


def resolve_workspace_path(relative_path):
    """Resolve a workspace-relative path and reject traversal attempts."""
    if not isinstance(relative_path, str) or not relative_path.strip():
        return None
    try:
        candidate = (WORKSPACE_PATH / relative_path).resolve()
    except Exception:
        return None
    try:
        candidate.relative_to(WORKSPACE_PATH)
    except ValueError:
        return None
    return candidate


def load_json_file(path):
    """Load JSON files defensively, accepting utf-8 and utf-8 with BOM."""
    last_error = None
    for encoding in ("utf-8-sig", "utf-8"):
        try:
            with open(path, 'r', encoding=encoding) as f:
                return json.load(f)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            last_error = exc
            continue
    if last_error:
        raise last_error
    raise ValueError(f"Unable to load JSON file: {path}")


def load_gateway_info():
    """Read local gateway bind/port/token to build a clickable control URL."""
    cfg = None
    for candidate in CONFIG_CANDIDATES:
        if not os.path.exists(candidate):
            continue
        try:
            cfg = load_json_file(candidate)
            break
        except Exception:
            continue
    if cfg is None:
        return {"url": "http://127.0.0.1:18789"}

    gateway = cfg.get("gateway", {}) if isinstance(cfg, dict) else {}
    port = gateway.get("port", 18789)
    auth = gateway.get("auth", {}) if isinstance(gateway, dict) else {}
    token = auth.get("token") if isinstance(auth, dict) else None
    if token:
        return {"url": f"http://127.0.0.1:{port}/?token={token}"}
    return {"url": f"http://127.0.0.1:{port}"}


def resolve_cli_binary():
    """Prefer openclaw, then fall back to clawdbot."""
    home = Path.home()
    candidates = [
        shutil.which("openclaw"),
        shutil.which("openclaw.cmd"),
        str(home / "AppData" / "Roaming" / "npm" / "openclaw.cmd"),
        shutil.which("clawdbot"),
        shutil.which("clawdbot.cmd"),
        str(home / "AppData" / "Roaming" / "npm" / "clawdbot.cmd"),
    ]
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate
    return None


def run_cli(args, timeout=20):
    cli = resolve_cli_binary()
    if not cli:
        raise RuntimeError("No CLI found (openclaw/clawdbot).")
    result = subprocess.run(
        [cli, *args],
        capture_output=True,
        text=True,
        timeout=timeout
    )
    if result.returncode != 0:
        details = (result.stderr or result.stdout or "").strip() or f"{cli} {' '.join(args)} failed"
        raise RuntimeError(details)
    return result.stdout, cli


def run_models_cli(args, timeout=20):
    return run_cli(["models", *args], timeout=timeout)


def _provider_from_model(model):
    if not isinstance(model, str) or not model.strip():
        return None
    model = model.strip()
    if "/" in model:
        return model.split("/", 1)[0]
    if model.startswith("claude-"):
        return "anthropic"
    if model.startswith("gpt-"):
        return "openai-codex"
    if model.startswith("o"):
        return "openai-codex"
    if model.startswith("llama") or model.startswith("gpt-oss"):
        return "ollama"
    return None


def _split_model_key(model_key):
    if not isinstance(model_key, str):
        return None, None
    trimmed = model_key.strip()
    if "/" not in trimmed:
        return None, None
    provider, model = trimmed.split("/", 1)
    provider = provider.strip()
    model = model.strip()
    if not provider or not model:
        return None, None
    return provider, model


def sync_main_session_model_in_stores(model_key):
    """Force main session metadata to reflect the selected model immediately."""
    provider, model = _split_model_key(model_key)
    if not provider or not model:
        return {"updated": 0, "errors": ["invalid model key"]}

    updated = 0
    errors = []
    now_ms = int(time.time() * 1000)
    for candidate in SESSION_STORE_CANDIDATES:
        if not os.path.exists(candidate):
            continue
        try:
            store = load_json_file(candidate)
            if not isinstance(store, dict):
                continue
            entry = store.get("agent:main:main")
            if not isinstance(entry, dict):
                continue
            entry["modelProvider"] = provider
            entry["model"] = model
            entry["updatedAt"] = max(int(entry.get("updatedAt", 0) or 0), now_ms)
            if "providerOverride" in entry:
                del entry["providerOverride"]
            if "modelOverride" in entry:
                del entry["modelOverride"]
            if "authProfileOverride" in entry:
                del entry["authProfileOverride"]
            if "authProfileOverrideSource" in entry:
                del entry["authProfileOverrideSource"]
            if "authProfileOverrideCompactionCount" in entry:
                del entry["authProfileOverrideCompactionCount"]
            store["agent:main:main"] = entry
            with open(candidate, "w", encoding="utf-8") as f:
                json.dump(store, f, indent=2, ensure_ascii=False)
            updated += 1
        except Exception as e:
            errors.append(f"{candidate}: {e}")

    _runtime_session_cache["at"] = 0.0
    _runtime_session_cache["info"] = None
    return {"updated": updated, "errors": errors}


def _pick_runtime_session_from_store(path):
    if not path or not os.path.exists(path):
        return None
    data = load_json_file(path)
    if not isinstance(data, dict) or not data:
        return None

    preferred = data.get("agent:main:main")
    if isinstance(preferred, dict):
        return preferred

    best = None
    best_ts = -1
    for entry in data.values():
        if not isinstance(entry, dict):
            continue
        updated_at = entry.get("updatedAt")
        if isinstance(updated_at, (int, float)) and updated_at > best_ts:
            best_ts = updated_at
            best = entry
    return best


def load_runtime_session_info(cache_seconds=5):
    """Best-effort active runtime model/provider from local session stores."""
    now = time.time()
    cached_at = _runtime_session_cache.get("at", 0.0)
    if now - cached_at < cache_seconds:
        return _runtime_session_cache.get("info")

    info = None

    for candidate in SESSION_STORE_CANDIDATES:
        try:
            session = _pick_runtime_session_from_store(candidate)
            if not isinstance(session, dict):
                continue
            model = session.get("model")
            provider = session.get("modelProvider") or _provider_from_model(model)
            if not model and not provider:
                continue
            info = {
                "model": model,
                "provider": provider,
                "sessionId": session.get("sessionId"),
                "source": f"session-store:{candidate}"
            }
            break
        except Exception:
            continue

    if not info:
        info = None

    _runtime_session_cache["at"] = now
    _runtime_session_cache["info"] = info
    return info


def load_models_state():
    """Return configured models + active default from the CLI JSON contracts."""
    status_stdout, cli = run_models_cli(["status", "--json"])
    list_stdout, _ = run_models_cli(["list", "--json"])
    status_data = json.loads(status_stdout)
    list_data = json.loads(list_stdout)
    models = list_data.get("models", []) if isinstance(list_data, dict) else []
    default_model = status_data.get("defaultModel") if isinstance(status_data, dict) else None
    return {
        "cli": cli,
        "defaultModel": default_model,
        "models": models
    }


def load_models_state_cached(force=False, ttl_seconds=300):
    """Cache model metadata so task/status endpoints are not blocked by CLI calls."""
    now = time.time()
    with _models_cache_lock:
        cached = _models_state_cache.get("data")
        cached_at = _models_state_cache.get("at", 0.0)
        if (not force) and cached and (now - cached_at) < ttl_seconds:
            return cached
    fresh = load_models_state()
    with _models_cache_lock:
        _models_state_cache["at"] = now
        _models_state_cache["data"] = fresh
        _models_state_cache["error"] = None
    return fresh


def start_models_refresh_if_needed(force=False, ttl_seconds=300):
    """Kick off a background refresh and return immediately."""
    global _models_refreshing
    now = time.time()
    with _models_cache_lock:
        cached = _models_state_cache.get("data")
        cached_at = _models_state_cache.get("at", 0.0)
        if _models_refreshing:
            return False
        if (not force) and cached and (now - cached_at) < ttl_seconds:
            return False
        _models_refreshing = True

    def _worker():
        global _models_refreshing
        try:
            fresh = load_models_state()
            with _models_cache_lock:
                _models_state_cache["at"] = time.time()
                _models_state_cache["data"] = fresh
                _models_state_cache["error"] = None
        except Exception as e:
            with _models_cache_lock:
                _models_state_cache["error"] = str(e)
        finally:
            with _models_cache_lock:
                _models_refreshing = False

    threading.Thread(target=_worker, daemon=True).start()
    return True


def snapshot_models_state():
    with _models_cache_lock:
        cached = _models_state_cache.get("data")
        cached_at = _models_state_cache.get("at", 0.0)
        error = _models_state_cache.get("error")
        refreshing = _models_refreshing
    age_ms = int(max(0.0, time.time() - cached_at) * 1000) if cached_at else None
    return {"data": cached, "ageMs": age_ms, "refreshing": refreshing, "error": error}


def prime_models_cache_default(model_key):
    """Immediately reflect default-model changes in cached /api/models payloads."""
    provider, model = _split_model_key(model_key)
    with _models_cache_lock:
        cached = _models_state_cache.get("data")
        if not isinstance(cached, dict):
            _models_state_cache["data"] = {
                "cli": resolve_cli_binary(),
                "defaultModel": model_key,
                "models": [],
            }
        else:
            next_data = dict(cached)
            next_data["defaultModel"] = model_key
            models = []
            for item in next_data.get("models", []):
                if not isinstance(item, dict):
                    continue
                row = dict(item)
                tags = row.get("tags")
                if isinstance(tags, list):
                    filtered = [t for t in tags if t != "default"]
                else:
                    filtered = []
                if row.get("key") == model_key and "default" not in filtered:
                    filtered.insert(0, "default")
                row["tags"] = filtered
                models.append(row)
            next_data["models"] = models
            _models_state_cache["data"] = next_data
        _models_state_cache["at"] = time.time()
        _models_state_cache["error"] = None
    _runtime_session_cache["at"] = 0.0
    _runtime_session_cache["info"] = {
        "model": model,
        "provider": provider,
        "sessionId": None,
        "source": "mission-control:model-select",
    }

def check_memory_health():
    """Check memory system integrity"""
    checks = {}
    errors = []
    warnings = []
    
    # Check state.json
    state_file = os.path.join(WORKSPACE_DIR, "memory", "state.json")
    if os.path.exists(state_file):
        try:
            state = load_json_file(state_file)
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
            state = load_json_file(state_file)
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
                return load_json_file(CURRENT_TASK_FILE)
    except:
        pass
    return None


def collect_lane_task_ids(lanes):
    """Return unique task IDs referenced by any lane, preserving lane order."""
    if not isinstance(lanes, dict):
        return []
    seen = set()
    ordered = []
    for lane_value in lanes.values():
        values = []
        if isinstance(lane_value, list):
            values = lane_value
        elif isinstance(lane_value, str):
            values = [lane_value]
        for task_id in values:
            if not isinstance(task_id, str):
                continue
            if task_id in seen:
                continue
            seen.add(task_id)
            ordered.append(task_id)
    return ordered


def normalize_task_timestamp(task, keys):
    for key in keys:
        value = task.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return None


def summarize_task_for_dashboard(task_id, task):
    """Build a compact task payload for fast board refreshes."""
    if not isinstance(task, dict):
        return {
            "id": task_id,
            "title": f"{task_id} (missing task payload)",
            "status": "missing",
            "__summary": True,
        }

    epistemic = task.get("epistemic") if isinstance(task.get("epistemic"), dict) else {}
    return {
        "id": task_id,
        "title": task.get("title"),
        "status": task.get("status"),
        "plan": task.get("plan"),
        "estimate": task.get("estimate"),
        "priority": task.get("priority"),
        "claimed_by": task.get("claimed_by"),
        "required_agent": task.get("required_agent"),
        "owner": task.get("owner"),
        "needs_verification": task.get("needs_verification"),
        "epistemic": {
            "verification_status": epistemic.get("verification_status"),
        },
        "stepCount": len(task.get("steps")) if isinstance(task.get("steps"), list) else 0,
        "current_step": task.get("current_step"),
        "retry_count": task.get("retry_count"),
        "created": normalize_task_timestamp(task, ["created", "created_at"]),
        "completed": normalize_task_timestamp(task, ["completed", "completed_at"]),
        "deleted_at": task.get("deleted_at"),
        "__summary": True,
    }


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
        provider_match = re.search(r'provider=(\S+)', msg)
        provider = provider_match.group(1) if provider_match else ""
        channel_match = re.search(r'messageChannel=(\S+)', msg)
        channel = channel_match.group(1) if channel_match else ""
        friendly = "Processing a new request"
        if channel:
            friendly += f" from {channel.title()}"
        return {"type": "run_start", "model": model, "provider": provider, "icon": "🧠", "friendly": friendly}
    
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
                            if cat.get("provider"):
                                activity_state["sessionInfo"]["provider"] = cat["provider"]
                        
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

        if path == '/api/model-select':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body) if body else {}
            except Exception:
                data = {}

            model = data.get('model')
            if not isinstance(model, str) or not model.strip():
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "model is required"}).encode('utf-8'))
                return

            try:
                normalized_model = model.strip()
                run_models_cli(["set", normalized_model])
                # Keep runtime session metadata in sync so switching from the UI is immediate.
                sync_result = sync_main_session_model_in_stores(normalized_model)
                prime_models_cache_default(normalized_model)
                start_models_refresh_if_needed(force=True)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                response = {
                    "ok": True,
                    "defaultModel": normalized_model,
                    "runtimeSyncedStores": sync_result.get("updated", 0),
                }
                sync_errors = sync_result.get("errors") or []
                if sync_errors:
                    response["syncErrors"] = sync_errors
                self.wfile.write(json.dumps(response).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
            return
        
        # Agent profile API - POST to save agent MD file
        if path == '/api/agent-profile':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body) if body else {}
            except:
                data = {}
            
            agent_type = data.get('agent')
            content = data.get('content')
            
            agent_files = {
                'research': 'agents/research-agent.md',
                'content': 'agents/content-agent.md',
                'audit': 'agents/audit-agent.md',
                'analytics': 'agents/analytics-agent.md',
                'code': 'agents/code-agent.md'
            }
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            if not agent_type or agent_type not in agent_files:
                self.wfile.write(json.dumps({"error": f"Invalid agent type: {agent_type}"}).encode())
                return
            
            if not content:
                self.wfile.write(json.dumps({"error": "Content required"}).encode())
                return
            
            agent_path = os.path.join(WORKSPACE_DIR, agent_files[agent_type])
            try:
                with open(agent_path, 'w', encoding='utf-8') as f:
                    f.write(content)
                self.wfile.write(json.dumps({"ok": True, "message": "Agent profile saved"}).encode())
            except Exception as e:
                self.wfile.write(json.dumps({"error": str(e)}).encode())
            return
        
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
                tasks_data = load_json_file(tasks_file)
                
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
                tasks_data = load_json_file(tasks_file)
                
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
                tasks_data = load_json_file(tasks_file)
                
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
            resolved_path = resolve_workspace_path(file_path)
            if resolved_path is None:
                self.send_response(403)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Access denied - path outside workspace"}).encode())
                return
            
            try:
                if resolved_path.exists():
                    with resolved_path.open('r', encoding='utf-8') as f:
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
                tasks_data = load_json_file(tasks_file)
                
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
                tasks_data = load_json_file(tasks_file)
                
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
                tasks_data = load_json_file(tasks_file)
                
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
                tasks_data = load_json_file(tasks_file)
                
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
                tasks_data = load_json_file(tasks_file)
                
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
                tasks_data = load_json_file(tasks_file)
                
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
                tasks_data = load_json_file(tasks_file)
                
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
        
        if path == '/api/generate-scenario':
            # Generate a Know Me scenario
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body) if body else {}
            except:
                data = {}
            
            category = data.get('category', 'fun')
            
            # Scenario templates by category
            scenarios = {
                'general': [
                    {"scenario": "You can have dinner with anyone alive. Who?", "prediction": "Elon Musk - you admire builders who think big and execute."},
                    {"scenario": "What matters more: being respected or being liked?", "prediction": "Respected. You value competence and results over popularity."},
                    {"scenario": "Morning person or night owl?", "prediction": "Morning person - you hit the gym, get things done early."},
                ],
                'decisions': [
                    {"scenario": "You find a $100 bill on the ground at the gym. No one's around. What do you do?", "prediction": "You'd turn it in to the front desk - honesty matters to you."},
                    {"scenario": "A client offers double your rate but wants you to work on something you find boring. Do you take it?", "prediction": "You'd take it - money is tight and practical needs come first."},
                    {"scenario": "Giselle wants to skip tennis practice for a friend's party. Karina says no, Giselle asks you to override. What do you do?", "prediction": "You back Karina - you two stay united in front of the kids."},
                ],
                'values': [
                    {"scenario": "What matters more: being respected or being liked?", "prediction": "Respected. You value competence and results over popularity."},
                    {"scenario": "If you could only teach your daughters ONE life lesson, what would it be?", "prediction": "Work ethic and self-reliance - do things yourself, don't depend on others."},
                    {"scenario": "Wealth vs Freedom vs Family time - rank them.", "prediction": "Family > Freedom > Wealth. But you see wealth as enabling the other two."},
                ],
                'reactions': [
                    {"scenario": "Someone cuts you off in traffic. What's your reaction?", "prediction": "Brief frustration, maybe a comment, but you let it go quickly. Not worth the energy."},
                    {"scenario": "I make the same mistake twice. How do you feel?", "prediction": "Disappointed but patient - as long as I show I'm learning and improving."},
                    {"scenario": "A friend asks to borrow $500 and you know they might not pay it back. Your reaction?", "prediction": "You'd find a way to say no diplomatically, or only lend what you can afford to lose."},
                ],
                'preferences': [
                    {"scenario": "Morning person or night owl?", "prediction": "Morning person - you hit the gym, get things done early."},
                    {"scenario": "Beach vacation or mountain adventure?", "prediction": "Beach - you grew up in Venezuela near the coast, it's in your blood."},
                    {"scenario": "Cook at home or eat out?", "prediction": "Eat out when possible - you'd rather spend time on business than cooking."},
                ],
                'family': [
                    {"scenario": "Giselle comes home with a B+ when she usually gets A's. Your response?", "prediction": "You'd ask what happened, encourage her, but not make it a big deal. One grade doesn't define her."},
                    {"scenario": "Amanda wants a pet. Karina says no. Amanda asks you. What do you say?", "prediction": "You side with Karina publicly, but might privately advocate for Amanda if you think it'd be good for her."},
                    {"scenario": "It's your anniversary. Big fancy dinner or quiet night in?", "prediction": "Quiet night or simple dinner out - you're not flashy about romance."},
                ],
                'business': [
                    {"scenario": "You can either make $1000 guaranteed or flip a coin for $3000 or nothing. Which do you pick?", "prediction": "The guaranteed $1000 - you've been burned before and prefer certainty now."},
                    {"scenario": "An investor offers $50K for 30% of Ghost Broker. Do you take it?", "prediction": "No - you'd rather grow slow and own 100% than give up control."},
                    {"scenario": "DLM gets a sudden spike in orders but you're deep in Ghost Broker work. What do you prioritize?", "prediction": "DLM - real revenue beats potential revenue. You handle what's paying first."},
                ],
                'fun': [
                    {"scenario": "You can have dinner with anyone alive. Who?", "prediction": "Elon Musk - you admire builders who think big and execute."},
                    {"scenario": "Superpower: flight or invisibility?", "prediction": "Invisibility - you value observing without being noticed."},
                    {"scenario": "Last meal on Earth - what is it?", "prediction": "Something Venezuelan - arepas or pabellón criollo. Taste of home."},
                ],
                'past': [
                    {"scenario": "What's a moment you're most proud of?", "prediction": "Building a business that hit $500K revenue on your own, with no employees."},
                    {"scenario": "A decision you regret?", "prediction": "The crypto investment that cost you $150K. Still stings."},
                    {"scenario": "Best advice you ever received?", "prediction": "Something your parents told you about self-reliance or working hard."},
                ],
                'future': [
                    {"scenario": "Where do you see yourself in 5 years?", "prediction": "Multiple income streams running semi-automated, more time with family, financial stress gone."},
                    {"scenario": "What's your biggest fear for your daughters?", "prediction": "That they won't develop the same work ethic and self-reliance you have."},
                    {"scenario": "If Ghost Broker fails completely, what do you do next?", "prediction": "Dust off, learn the lesson, try something else. You don't stay down long."},
                ],
            }
            
            import random
            cat_scenarios = scenarios.get(category, scenarios['fun'])
            chosen = random.choice(cat_scenarios)
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "category": category,
                "scenario": chosen["scenario"],
                "prediction": chosen["prediction"]
            }).encode())
            return

        if path == '/api/submit-qa':
            # Save Q&A response
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body) if body else {}
            except:
                data = {}
            
            qa_file = os.path.join(WORKSPACE_DIR, "memory", "francisco-qa.jsonl")
            entry = {
                "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                "time": datetime.now(timezone.utc).strftime("%H:%M:%S"),
                "category": data.get('category'),
                "scenario": data.get('scenario'),
                "prediction": data.get('prediction'),
                "answer": data.get('answer'),
                "score": data.get('score')
            }
            
            with open(qa_file, 'a', encoding='utf-8') as f:
                f.write(json.dumps(entry) + '\n')
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True}).encode())
            return

        if path == '/api/prediction-feedback':
            # Save written feedback for a prediction
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body) if body else {}
            except:
                data = {}
            
            pred_id = data.get('id')
            feedback = data.get('feedback', '').strip()
            
            if not pred_id or not feedback:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Missing id or feedback"}).encode())
                return
            
            predictions_file = os.path.join(DASHBOARD_DIR, "predictions.json")
            try:
                with open(predictions_file, 'r', encoding='utf-8') as f:
                    preds = json.load(f)
                
                # Find and update the prediction
                for p in preds.get('predictions', []):
                    if p.get('id') == pred_id:
                        p['feedback'] = feedback
                        p['feedback_at'] = datetime.now(timezone.utc).isoformat()
                        break
                
                preds['version'] += 1
                with open(predictions_file, 'w', encoding='utf-8') as f:
                    json.dump(preds, f, indent=4)
                
                # Log to predictions log
                log_file = os.path.join(WORKSPACE_DIR, "memory", "predictions-log.jsonl")
                log_entry = {
                    "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                    "time": datetime.now(timezone.utc).strftime("%H:%M:%S"),
                    "event": "feedback",
                    "prediction_id": pred_id,
                    "feedback": feedback
                }
                with open(log_file, 'a', encoding='utf-8') as f:
                    f.write(json.dumps(log_entry) + '\n')
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True}).encode())
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
                
                # Track battle scores
                game['total_rating_sum'] = game.get('total_rating_sum', 0) + score
                game['bot_score'] = round(game['total_rating_sum'] / game['total_scored'], 1)
                
                if score <= 2:  # Human found a blind spot!
                    game['blind_spots_found'] = game.get('blind_spots_found', 0) + 1
                game['human_score'] = game.get('blind_spots_found', 0)
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

        # Serve dashboard HTML from the mission-control directory explicitly.
        # This avoids stale/incorrect pages when the server is launched from a different cwd.
        if path in ('/', '/index.html'):
            dashboard_path = os.path.join(DASHBOARD_DIR, 'index.html')
            try:
                with open(dashboard_path, 'rb') as f:
                    payload = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
                self.send_header('Pragma', 'no-cache')
                self.send_header('Expires', '0')
                self.end_headers()
                self.wfile.write(payload)
                return
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
                return
        
        if path == '/api/qa-history':
            # Return Q&A game history
            qa_file = os.path.join(WORKSPACE_DIR, "memory", "francisco-qa.jsonl")
            try:
                entries = []
                if os.path.exists(qa_file):
                    with open(qa_file, 'r', encoding='utf-8') as f:
                        for line in f:
                            line = line.strip()
                            if line:
                                entry = json.loads(line)
                                if entry.get('type') != 'system':  # Skip system entries
                                    entries.append(entry)
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
        
        # Agent profile API - GET to read agent MD file
        if path.startswith('/api/agent-profile'):
            query = parse_qs(urlparse(self.path).query)
            agent_type = query.get('agent', [None])[0]
            
            agent_files = {
                'research': 'agents/research-agent.md',
                'content': 'agents/content-agent.md',
                'audit': 'agents/audit-agent.md',
                'analytics': 'agents/analytics-agent.md',
                'code': 'agents/code-agent.md'
            }
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            if not agent_type or agent_type not in agent_files:
                self.wfile.write(json.dumps({"error": f"Invalid agent type: {agent_type}"}).encode())
                return
            
            agent_path = os.path.join(WORKSPACE_DIR, agent_files[agent_type])
            try:
                if os.path.exists(agent_path):
                    with open(agent_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                    self.wfile.write(json.dumps({"ok": True, "content": content, "path": agent_files[agent_type]}).encode())
                else:
                    self.wfile.write(json.dumps({"error": f"Agent file not found: {agent_files[agent_type]}"}).encode())
            except Exception as e:
                self.wfile.write(json.dumps({"error": str(e)}).encode())
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
        
        if path == '/api/cron-jobs':
            # Read cron jobs from cached file (updated periodically by bot)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            
            try:
                cron_file = os.path.join(DASHBOARD_DIR, "cron-jobs.json")
                if os.path.exists(cron_file):
                    with open(cron_file, 'r', encoding='utf-8') as f:
                        cron_data = json.load(f)
                    self.wfile.write(json.dumps(cron_data, indent=2, ensure_ascii=False).encode('utf-8'))
                else:
                    self.wfile.write(json.dumps({"jobs": [], "error": "cron-jobs.json not found"}).encode('utf-8'))
            except Exception as e:
                self.wfile.write(json.dumps({"error": str(e), "jobs": []}).encode('utf-8'))
            return

        if path == '/api/task':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            try:
                query = parse_qs(urlparse(self.path).query)
                task_id = query.get('id', [None])[0]
                if not isinstance(task_id, str) or not task_id.strip():
                    self.wfile.write(json.dumps({"error": "task id is required"}).encode('utf-8'))
                    return
                task_id = task_id.strip()
                tasks_file = os.path.join(WORKSPACE_DIR, "memory", "tasks.json")
                if not os.path.exists(tasks_file):
                    self.wfile.write(json.dumps({"error": "tasks.json not found"}).encode('utf-8'))
                    return

                tasks_data = load_json_file(tasks_file)
                tasks = tasks_data.get("tasks", {}) if isinstance(tasks_data, dict) else {}
                task = tasks.get(task_id) if isinstance(tasks, dict) else None
                if not isinstance(task, dict):
                    self.wfile.write(json.dumps({"error": f"task not found: {task_id}"}).encode('utf-8'))
                    return
                self.wfile.write(json.dumps({"id": task_id, "task": task}, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
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
                    tasks_data = load_json_file(tasks_file)
                    
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
                    
                    tasks_map = tasks_data.get('tasks', {})
                    lane_task_ids = collect_lane_task_ids(lanes)
                    compact_tasks = {}
                    if isinstance(tasks_map, dict):
                        for task_id in lane_task_ids:
                            compact_tasks[task_id] = summarize_task_for_dashboard(
                                task_id,
                                tasks_map.get(task_id),
                            )

                    payload = {
                        "version": tasks_data.get("version"),
                        "updated_at": tasks_data.get("updated_at"),
                        "updated_by": tasks_data.get("updated_by"),
                        "lanes": lanes,
                        "tasks": compact_tasks,
                        "tasks_in_lanes": len(compact_tasks),
                        "tasks_total": len(tasks_map) if isinstance(tasks_map, dict) else 0,
                    }
                    self.wfile.write(json.dumps(payload, ensure_ascii=False).encode('utf-8'))
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
            # Return lightweight UI status + a direct gateway control URL.
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
            gateway_info = load_gateway_info()
            runtime_info = load_runtime_session_info()
            session_info = dict(activity_state.get("sessionInfo", {}))
            if isinstance(runtime_info, dict):
                for key in ("model", "provider", "sessionId", "source"):
                    value = runtime_info.get(key)
                    if value is not None and value != "":
                        session_info[key] = value

            self.wfile.write(json.dumps({
                "online": online,
                "uptime": uptime,
                "status": activity_state.get("status", "unknown"),
                "sessionInfo": session_info,
                "gateway": gateway_info
            }).encode())
            return

        if path == '/api/models':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            start_models_refresh_if_needed()
            snap = snapshot_models_state()
            cached = snap.get("data")
            if isinstance(cached, dict):
                payload = dict(cached)
                # Never block the selector when we already have cached model rows.
                payload["loading"] = False
                payload["refreshing"] = bool(snap.get("refreshing"))
                payload["cacheAgeMs"] = snap.get("ageMs")
                if snap.get("error"):
                    payload["warning"] = snap.get("error")
                self.wfile.write(json.dumps(payload).encode('utf-8'))
                return
            self.wfile.write(json.dumps({
                "loading": True,
                "cacheAgeMs": snap.get("ageMs"),
                "error": snap.get("error"),
                "models": [],
                "defaultModel": None
            }).encode('utf-8'))
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
    # Warm model cache eagerly so first dashboard paint has model options quickly.
    start_models_refresh_if_needed(force=True)
    dashboard_host = "localhost" if BIND_HOST in ("127.0.0.1", "::1") else BIND_HOST
    print(f"Activity server starting on port {PORT}")
    print(f"Dashboard: http://{dashboard_host}:{PORT}")
    print(f"Activity API: http://{dashboard_host}:{PORT}/api/activity")
    if _generated_dashboard_key:
        print("DASHBOARD_KEY not set; generated an ephemeral key for this process.")
    if BIND_HOST in ("0.0.0.0", "::"):
        print(f"LAN access URL: http://<host-ip>:{PORT}/?key={DASHBOARD_KEY}")
    
    http.server.HTTPServer.allow_reuse_address = True
    server = http.server.HTTPServer((BIND_HOST, PORT), ActivityHandler)
    print("Server bound and listening...")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == '__main__':
    main()
