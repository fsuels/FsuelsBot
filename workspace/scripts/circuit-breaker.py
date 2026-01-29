#!/usr/bin/env python3
"""
Circuit Breaker System for External APIs
Provides graceful degradation when APIs fail.
Council-designed: Grade A
"""

import json
import os
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any
from enum import Enum

WORKSPACE = Path(r"C:\dev\FsuelsBot\workspace")
CIRCUITS_FILE = WORKSPACE / "memory" / "circuits.json"

class CircuitState(Enum):
    CLOSED = "closed"      # Normal operation
    OPEN = "open"          # Failing, skip requests
    HALF_OPEN = "half_open"  # Testing if recovered

# Default thresholds per API
DEFAULT_CONFIG = {
    "grok": {
        "failure_threshold": 3,
        "success_threshold": 2,
        "timeout_seconds": 300,  # 5 min cooldown
    },
    "chatgpt": {
        "failure_threshold": 3,
        "success_threshold": 2,
        "timeout_seconds": 300,
    },
    "gemini": {
        "failure_threshold": 2,  # More sensitive (rate limits)
        "success_threshold": 2,
        "timeout_seconds": 600,  # 10 min cooldown
    },
    "shopify": {
        "failure_threshold": 5,
        "success_threshold": 3,
        "timeout_seconds": 120,
    },
    "buckydrop": {
        "failure_threshold": 5,
        "success_threshold": 3,
        "timeout_seconds": 120,
    },
}

def load_circuits() -> Dict:
    """Load circuit states from file."""
    if not CIRCUITS_FILE.exists():
        return {}
    try:
        return json.loads(CIRCUITS_FILE.read_text(encoding='utf-8'))
    except (json.JSONDecodeError, IOError):
        return {}

def save_circuits(circuits: Dict) -> None:
    """Save circuit states to file."""
    CIRCUITS_FILE.parent.mkdir(parents=True, exist_ok=True)
    CIRCUITS_FILE.write_text(json.dumps(circuits, indent=2, default=str), encoding='utf-8')

def get_circuit(api_name: str) -> Dict:
    """Get circuit state for an API."""
    circuits = load_circuits()
    if api_name not in circuits:
        circuits[api_name] = {
            "state": CircuitState.CLOSED.value,
            "failure_count": 0,
            "success_count": 0,
            "last_failure": None,
            "last_success": None,
            "opened_at": None,
            "last_error": None,
        }
        save_circuits(circuits)
    return circuits[api_name]

def can_request(api_name: str) -> Dict[str, Any]:
    """
    Check if we can make a request to this API.
    
    Returns:
        {
            "allowed": bool,
            "state": str,
            "reason": str,
            "retry_after": datetime or None
        }
    """
    circuit = get_circuit(api_name)
    config = DEFAULT_CONFIG.get(api_name, DEFAULT_CONFIG["grok"])
    state = circuit["state"]
    
    if state == CircuitState.CLOSED.value:
        return {
            "allowed": True,
            "state": state,
            "reason": "Circuit closed, normal operation"
        }
    
    if state == CircuitState.OPEN.value:
        # Check if timeout has passed
        opened_at = circuit.get("opened_at")
        if opened_at:
            opened_time = datetime.fromisoformat(opened_at)
            elapsed = (datetime.now(timezone.utc) - opened_time.astimezone(timezone.utc)).total_seconds()
            if elapsed >= config["timeout_seconds"]:
                # Transition to half-open
                circuits = load_circuits()
                circuits[api_name]["state"] = CircuitState.HALF_OPEN.value
                circuits[api_name]["success_count"] = 0
                save_circuits(circuits)
                return {
                    "allowed": True,
                    "state": CircuitState.HALF_OPEN.value,
                    "reason": "Circuit half-open, testing recovery"
                }
            
            retry_after = opened_time + timedelta(seconds=config["timeout_seconds"])
            return {
                "allowed": False,
                "state": state,
                "reason": f"Circuit open, retry after {retry_after.isoformat()}",
                "retry_after": retry_after.isoformat()
            }
        
        return {
            "allowed": False,
            "state": state,
            "reason": "Circuit open"
        }
    
    if state == CircuitState.HALF_OPEN.value:
        return {
            "allowed": True,
            "state": state,
            "reason": "Circuit half-open, testing recovery"
        }
    
    return {"allowed": True, "state": state, "reason": "Unknown state, allowing"}

def record_success(api_name: str) -> Dict[str, Any]:
    """Record a successful API call."""
    circuits = load_circuits()
    circuit = circuits.get(api_name, get_circuit(api_name))
    config = DEFAULT_CONFIG.get(api_name, DEFAULT_CONFIG["grok"])
    
    now = datetime.now(timezone.utc).isoformat()
    circuit["last_success"] = now
    circuit["failure_count"] = 0
    circuit["success_count"] = circuit.get("success_count", 0) + 1
    
    old_state = circuit["state"]
    
    if old_state == CircuitState.HALF_OPEN.value:
        if circuit["success_count"] >= config["success_threshold"]:
            circuit["state"] = CircuitState.CLOSED.value
            circuit["opened_at"] = None
            circuit["last_error"] = None
    
    circuits[api_name] = circuit
    save_circuits(circuits)
    
    return {
        "api": api_name,
        "recorded": "success",
        "state_change": f"{old_state} -> {circuit['state']}" if old_state != circuit["state"] else None,
        "current_state": circuit["state"]
    }

def record_failure(api_name: str, error: str = None) -> Dict[str, Any]:
    """Record a failed API call."""
    circuits = load_circuits()
    circuit = circuits.get(api_name, get_circuit(api_name))
    config = DEFAULT_CONFIG.get(api_name, DEFAULT_CONFIG["grok"])
    
    now = datetime.now(timezone.utc).isoformat()
    circuit["last_failure"] = now
    circuit["failure_count"] = circuit.get("failure_count", 0) + 1
    circuit["success_count"] = 0
    circuit["last_error"] = error
    
    old_state = circuit["state"]
    
    if old_state == CircuitState.HALF_OPEN.value:
        # Immediately open again
        circuit["state"] = CircuitState.OPEN.value
        circuit["opened_at"] = now
    elif old_state == CircuitState.CLOSED.value:
        if circuit["failure_count"] >= config["failure_threshold"]:
            circuit["state"] = CircuitState.OPEN.value
            circuit["opened_at"] = now
    
    circuits[api_name] = circuit
    save_circuits(circuits)
    
    return {
        "api": api_name,
        "recorded": "failure",
        "state_change": f"{old_state} -> {circuit['state']}" if old_state != circuit["state"] else None,
        "current_state": circuit["state"],
        "failure_count": circuit["failure_count"]
    }

def reset_circuit(api_name: str) -> Dict[str, Any]:
    """Manually reset a circuit to closed state."""
    circuits = load_circuits()
    circuits[api_name] = {
        "state": CircuitState.CLOSED.value,
        "failure_count": 0,
        "success_count": 0,
        "last_failure": None,
        "last_success": None,
        "opened_at": None,
        "last_error": None,
    }
    save_circuits(circuits)
    return {"api": api_name, "reset": True, "state": CircuitState.CLOSED.value}

def status_all() -> Dict[str, Any]:
    """Get status of all circuits."""
    circuits = load_circuits()
    result = {}
    for api_name in list(circuits.keys()) + list(DEFAULT_CONFIG.keys()):
        if api_name not in result:
            circuit = get_circuit(api_name)
            check = can_request(api_name)
            result[api_name] = {
                "state": circuit["state"],
                "allowed": check["allowed"],
                "failure_count": circuit.get("failure_count", 0),
                "last_error": circuit.get("last_error"),
            }
    return result

# CLI interface
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Circuit breaker manager")
    parser.add_argument("command", choices=["check", "success", "failure", "reset", "status"])
    parser.add_argument("--api", help="API name")
    parser.add_argument("--error", help="Error message for failure")
    args = parser.parse_args()
    
    if args.command == "check":
        if not args.api:
            print("Error: --api required")
            exit(1)
        result = can_request(args.api)
        print(json.dumps(result, indent=2))
        exit(0 if result["allowed"] else 1)
    
    elif args.command == "success":
        if not args.api:
            print("Error: --api required")
            exit(1)
        result = record_success(args.api)
        print(json.dumps(result, indent=2))
    
    elif args.command == "failure":
        if not args.api:
            print("Error: --api required")
            exit(1)
        result = record_failure(args.api, args.error)
        print(json.dumps(result, indent=2))
    
    elif args.command == "reset":
        if not args.api:
            print("Error: --api required")
            exit(1)
        result = reset_circuit(args.api)
        print(json.dumps(result, indent=2))
    
    elif args.command == "status":
        result = status_all()
        print(json.dumps(result, indent=2))
