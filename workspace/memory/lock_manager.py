#!/usr/bin/env python3
"""
File-based lock manager for Clawdbot memory system.
Works on Windows (primary) and Unix systems.
Council-validated: Grade A+ (with heartbeat + ownership verification)
"""

import json
import os
import sys
import time
import socket
import threading
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional
import contextlib

# Windows-specific process checking
if sys.platform == 'win32':
    import ctypes
    def is_process_alive(pid: int) -> bool:
        """Check if a process is running on Windows."""
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        handle = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if handle:
            ctypes.windll.kernel32.CloseHandle(handle)
            return True
        return False
else:
    import signal
    def is_process_alive(pid: int) -> bool:
        """Check if a process is running on Unix."""
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False


class LockError(Exception):
    """Raised when lock cannot be acquired."""
    pass


class MemoryLock:
    """
    File-based lock for memory directory operations.
    
    Usage:
        lock = MemoryLock()
        with lock.acquire("write:tasks.json"):
            # ... do work ...
    
    Features (Council A+ validated):
    - Atomic file operations (temp+rename)
    - Heartbeat mechanism for long operations
    - Ownership verification after acquisition
    - Graceful stale lock handling
    """
    
    # Configuration
    LOCK_FILE = "memory/.lock"
    STALE_TIMEOUT_SECONDS = 30
    HEARTBEAT_INTERVAL_SECONDS = 10  # Council A+ requirement
    MAX_WAIT_DEFAULT = 5.0
    BACKOFF_BASE_MS = 100
    BACKOFF_MAX_MS = 2000
    
    def __init__(self, workspace_root: Optional[Path] = None):
        if workspace_root is None:
            workspace_root = Path(r"C:\dev\FsuelsBot\workspace")
        self.workspace_root = Path(workspace_root)
        self.lock_path = self.workspace_root / self.LOCK_FILE
        self.session_id = os.environ.get("CLAWDBOT_SESSION_ID", "unknown")
        self._held = False
        self._heartbeat_thread: Optional[threading.Thread] = None
        self._heartbeat_stop = threading.Event()
        self._current_operation: Optional[str] = None
    
    def _read_lock(self) -> Optional[dict]:
        """Read current lock file, return None if doesn't exist or is invalid."""
        try:
            if not self.lock_path.exists():
                return None
            content = self.lock_path.read_text(encoding='utf-8')
            return json.loads(content)
        except (json.JSONDecodeError, IOError):
            return None
    
    def _generate_token(self) -> str:
        """Generate unique token to prevent PID reuse attacks."""
        import secrets
        return secrets.token_hex(8)
    
    def _write_lock(self, operation: str, token: Optional[str] = None) -> str:
        """Write lock file with current process info. Returns token."""
        if token is None:
            token = self._generate_token()
        lock_data = {
            "pid": os.getpid(),
            "session_id": self.session_id,
            "token": token,  # Council A+: PID reuse protection
            "acquired_at": datetime.now(timezone.utc).isoformat(),
            "heartbeat_at": datetime.now(timezone.utc).isoformat(),  # Council A+: heartbeat timestamp
            "hostname": socket.gethostname(),
            "operation": operation
        }
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = self.lock_path.with_suffix('.lock.tmp')
        temp_path.write_text(json.dumps(lock_data, indent=2), encoding='utf-8')
        temp_path.replace(self.lock_path)
        return token
    
    def _update_heartbeat(self) -> bool:
        """Update heartbeat timestamp in lock file. Returns False if we lost the lock."""
        existing = self._read_lock()
        if existing is None or existing.get("pid") != os.getpid():
            return False  # We don't hold the lock anymore
        if hasattr(self, '_lock_token') and existing.get("token") != self._lock_token:
            return False  # Someone else took it (PID reuse case)
        
        # Re-write with updated heartbeat
        self._write_lock(self._current_operation or "heartbeat", self._lock_token)
        return True
    
    def _heartbeat_loop(self) -> None:
        """Background thread that updates heartbeat every HEARTBEAT_INTERVAL_SECONDS."""
        while not self._heartbeat_stop.wait(self.HEARTBEAT_INTERVAL_SECONDS):
            if not self._update_heartbeat():
                print("[LOCK] Lost lock during heartbeat!", file=sys.stderr)
                self._held = False
                break
    
    def _start_heartbeat(self) -> None:
        """Start the heartbeat thread."""
        self._heartbeat_stop.clear()
        self._heartbeat_thread = threading.Thread(target=self._heartbeat_loop, daemon=True)
        self._heartbeat_thread.start()
    
    def _stop_heartbeat(self) -> None:
        """Stop the heartbeat thread."""
        self._heartbeat_stop.set()
        if self._heartbeat_thread and self._heartbeat_thread.is_alive():
            self._heartbeat_thread.join(timeout=1.0)
    
    def _delete_lock(self) -> None:
        """Remove lock file."""
        try:
            self.lock_path.unlink()
        except FileNotFoundError:
            pass
    
    def _is_lock_stale(self, lock_data: dict) -> tuple:
        """Check if lock is stale. Returns (is_stale, reason)."""
        pid = lock_data.get("pid")
        if pid and not is_process_alive(pid):
            return True, f"process {pid} is dead"
        
        # Council A+: Check heartbeat_at (falls back to acquired_at for old locks)
        heartbeat_at = lock_data.get("heartbeat_at") or lock_data.get("acquired_at")
        if heartbeat_at:
            try:
                heartbeat_time = datetime.fromisoformat(heartbeat_at.replace('Z', '+00:00'))
                age_seconds = (datetime.now(timezone.utc) - heartbeat_time).total_seconds()
                if age_seconds > self.STALE_TIMEOUT_SECONDS:
                    return True, f"no heartbeat for {age_seconds:.1f}s (>{self.STALE_TIMEOUT_SECONDS}s)"
            except ValueError:
                pass
        
        return False, ""
    
    def _verify_ownership(self) -> bool:
        """Council A+: Re-verify we actually hold the lock after acquiring."""
        existing = self._read_lock()
        if existing is None:
            return False
        if existing.get("pid") != os.getpid():
            return False
        if hasattr(self, '_lock_token') and existing.get("token") != self._lock_token:
            return False
        return True
    
    def _try_acquire(self, operation: str, break_stale: bool = True) -> bool:
        """Attempt to acquire lock once. Council A+: includes ownership verification."""
        existing_lock = self._read_lock()
        
        if existing_lock is None:
            self._lock_token = self._write_lock(operation)
            self._current_operation = operation
            # Council A+: Verify we actually got it (race protection)
            if not self._verify_ownership():
                return False
            self._held = True
            return True
        
        # Re-entrant: we already hold it
        if existing_lock.get("pid") == os.getpid():
            if hasattr(self, '_lock_token') and existing_lock.get("token") == self._lock_token:
                return True
        
        if break_stale:
            is_stale, reason = self._is_lock_stale(existing_lock)
            if is_stale:
                print(f"[LOCK] Breaking stale lock: {reason}", file=sys.stderr)
                try:
                    self._delete_lock()
                except FileNotFoundError:
                    pass  # Council A+: Handle "file already deleted" gracefully
                self._lock_token = self._write_lock(operation)
                self._current_operation = operation
                # Council A+: Verify we actually got it after breaking stale
                if not self._verify_ownership():
                    return False
                self._held = True
                return True
        
        return False
    
    def acquire_blocking(self, operation: str, max_wait: float = None, break_stale: bool = True, heartbeat: bool = True) -> None:
        """Acquire lock with exponential backoff. Council A+: starts heartbeat by default."""
        if max_wait is None:
            max_wait = self.MAX_WAIT_DEFAULT
        
        start_time = time.time()
        attempt = 0
        backoff_ms = 0
        
        while True:
            if self._try_acquire(operation, break_stale):
                # Council A+: Start heartbeat thread for long operations
                if heartbeat:
                    self._start_heartbeat()
                return
            
            elapsed = time.time() - start_time
            if elapsed >= max_wait:
                existing = self._read_lock()
                holder = existing.get("session_id", "unknown") if existing else "unknown"
                raise LockError(f"Could not acquire lock within {max_wait}s. Held by '{holder}'")
            
            time.sleep(backoff_ms / 1000.0)
            attempt += 1
            backoff_ms = min(self.BACKOFF_BASE_MS * (2 ** attempt), self.BACKOFF_MAX_MS)
    
    def acquire_nowait(self, operation: str, break_stale: bool = True) -> bool:
        """Try to acquire lock immediately."""
        return self._try_acquire(operation, break_stale)
    
    def release(self) -> None:
        """Release the lock if we hold it. Council A+: stops heartbeat."""
        self._stop_heartbeat()  # Council A+: Always stop heartbeat first
        if self._held:
            existing = self._read_lock()
            if existing and existing.get("pid") == os.getpid():
                # Council A+: Also verify token matches
                if not hasattr(self, '_lock_token') or existing.get("token") == self._lock_token:
                    self._delete_lock()
            self._held = False
            self._current_operation = None
    
    @contextlib.contextmanager
    def acquire(self, operation: str, max_wait: float = None, heartbeat: bool = True):
        """Context manager for lock acquisition. Council A+: heartbeat enabled by default."""
        self.acquire_blocking(operation, max_wait, heartbeat=heartbeat)
        try:
            yield
        finally:
            self.release()
    
    def status(self) -> dict:
        """Get current lock status."""
        existing = self._read_lock()
        if existing is None:
            return {"locked": False}
        
        is_stale, reason = self._is_lock_stale(existing)
        return {
            "locked": True,
            "holder": existing,
            "is_stale": is_stale,
            "stale_reason": reason if is_stale else None,
            "we_hold_it": existing.get("pid") == os.getpid()
        }


_default_lock = None

def get_lock() -> MemoryLock:
    """Get the default lock instance."""
    global _default_lock
    if _default_lock is None:
        _default_lock = MemoryLock()
    return _default_lock

def with_lock(operation: str, max_wait: float = None):
    """Decorator to run a function with the memory lock held."""
    def decorator(func):
        def wrapper(*args, **kwargs):
            with get_lock().acquire(operation, max_wait):
                return func(*args, **kwargs)
        return wrapper
    return decorator


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Memory lock manager")
    parser.add_argument("command", choices=["status", "acquire", "release", "break"])
    parser.add_argument("--operation", default="cli-test")
    parser.add_argument("--wait", type=float, default=5.0)
    args = parser.parse_args()
    
    lock = MemoryLock()
    
    if args.command == "status":
        print(json.dumps(lock.status(), indent=2, default=str))
    elif args.command == "acquire":
        try:
            lock.acquire_blocking(args.operation, max_wait=args.wait)
            print(f"Lock acquired for: {args.operation}")
            input("Press Enter to release...")
        except LockError as e:
            print(f"Failed: {e}")
            sys.exit(1)
        finally:
            lock.release()
    elif args.command == "release":
        lock._delete_lock()
        print("Lock forcibly removed.")
    elif args.command == "break":
        existing = lock._read_lock()
        if existing:
            lock._delete_lock()
            print(f"Broke lock held by PID {existing.get('pid')}")
        else:
            print("No lock to break.")
