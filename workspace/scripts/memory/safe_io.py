#!/usr/bin/env python3
"""
Safe I/O Operations for OpenClaw Memory System
Atomic writes, integrity checks, and recovery.

Usage:
    from safe_io import atomic_append, atomic_write, verify_integrity
"""

import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Optional

WORKSPACE = Path.home() / "clawd"
MEMORY_DIR = WORKSPACE / "memory"


def atomic_append(path: Path, line: str) -> bool:
    """
    Atomically append a line to a JSONL file.
    
    Process:
    1. Read existing content
    2. Write to temp file (existing + new line)
    3. Atomic rename temp → target
    
    This prevents corruption from crashes mid-write.
    """
    path = Path(path)
    
    # Ensure line ends with newline
    if not line.endswith('\n'):
        line = line + '\n'
    
    # For JSONL, we can safely just append if file exists
    # The atomic concern is mainly for the new line
    try:
        # Create temp file in same directory (for same-filesystem rename)
        fd, tmp_path = tempfile.mkstemp(
            dir=path.parent, 
            prefix=f".{path.name}.",
            suffix=".tmp"
        )
        
        try:
            # Copy existing content
            if path.exists():
                with open(path, 'rb') as src:
                    os.write(fd, src.read())
            
            # Append new line
            os.write(fd, line.encode('utf-8'))
            os.fsync(fd)  # Ensure written to disk
        finally:
            os.close(fd)
        
        # Atomic rename
        os.replace(tmp_path, path)
        return True
        
    except Exception as e:
        # Clean up temp file if it exists
        if 'tmp_path' in locals() and os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise


def atomic_write(path: Path, content: str) -> bool:
    """
    Atomically write entire file content.
    
    Process:
    1. Write to temp file
    2. Atomic rename temp → target
    """
    path = Path(path)
    
    try:
        fd, tmp_path = tempfile.mkstemp(
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp"
        )
        
        try:
            os.write(fd, content.encode('utf-8'))
            os.fsync(fd)
        finally:
            os.close(fd)
        
        os.replace(tmp_path, path)
        return True
        
    except Exception as e:
        if 'tmp_path' in locals() and os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise


def compute_checksum(path: Path) -> str:
    """Compute SHA256 checksum of file."""
    sha256 = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            sha256.update(chunk)
    return sha256.hexdigest()


def verify_jsonl(path: Path) -> tuple[bool, int, list[str]]:
    """
    Verify JSONL file integrity.
    Returns (is_valid, line_count, errors).
    """
    errors = []
    count = 0
    
    if not path.exists():
        return False, 0, [f"File not found: {path}"]
    
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            
            try:
                json.loads(line)
                count += 1
            except json.JSONDecodeError as e:
                errors.append(f"Line {i}: {e}")
    
    return len(errors) == 0, count, errors


def verify_embedding_integrity(
    index_path: Path = MEMORY_DIR / "embeddings" / "index.json",
    vectors_path: Path = MEMORY_DIR / "embeddings" / "vectors.npy",
    ledger_path: Path = MEMORY_DIR / "ledger.jsonl"
) -> dict:
    """
    Verify embedding index consistency with ledger.
    
    Checks:
    1. Index JSON is valid
    2. Vectors file exists and matches index count
    3. Event IDs in index exist in ledger
    """
    result = {
        "valid": True,
        "index_count": 0,
        "vector_count": 0,
        "ledger_count": 0,
        "missing_in_ledger": [],
        "errors": []
    }
    
    # Check index
    if not index_path.exists():
        result["valid"] = False
        result["errors"].append("Index file not found")
        return result
    
    try:
        with open(index_path) as f:
            index = json.load(f)
        result["index_count"] = len(index.get("entries", []))
    except Exception as e:
        result["valid"] = False
        result["errors"].append(f"Index parse error: {e}")
        return result
    
    # Check vectors
    if not vectors_path.exists():
        result["valid"] = False
        result["errors"].append("Vectors file not found")
    else:
        try:
            import numpy as np
            vectors = np.load(vectors_path)
            result["vector_count"] = len(vectors)
            
            if result["vector_count"] != result["index_count"]:
                result["valid"] = False
                result["errors"].append(
                    f"Count mismatch: {result['index_count']} index entries, "
                    f"{result['vector_count']} vectors"
                )
        except Exception as e:
            result["errors"].append(f"Vector load error: {e}")
    
    # Check ledger IDs
    if ledger_path.exists():
        ledger_ids = set()
        with open(ledger_path, encoding='utf-8', errors='replace') as f:
            for line in f:
                try:
                    event = json.loads(line)
                    ledger_ids.add(event.get("id", ""))
                    result["ledger_count"] += 1
                except:
                    pass
        
        # Check if index IDs exist in ledger
        for entry in index.get("entries", []):
            entry_id = entry.get("id", "")
            if entry_id and entry_id not in ledger_ids:
                result["missing_in_ledger"].append(entry_id)
        
        if result["missing_in_ledger"]:
            result["errors"].append(
                f"{len(result['missing_in_ledger'])} index entries not in ledger"
            )
    
    return result


def memory_health_check() -> dict:
    """
    Comprehensive health check for memory system.
    """
    status = {
        "healthy": True,
        "checks": {}
    }
    
    # Check ledger
    ledger_valid, ledger_count, ledger_errors = verify_jsonl(MEMORY_DIR / "ledger.jsonl")
    status["checks"]["ledger"] = {
        "valid": ledger_valid,
        "count": ledger_count,
        "errors": ledger_errors[:5]  # First 5 only
    }
    if not ledger_valid:
        status["healthy"] = False
    
    # Check embeddings
    embed_result = verify_embedding_integrity()
    status["checks"]["embeddings"] = {
        "valid": embed_result["valid"],
        "index_count": embed_result["index_count"],
        "vector_count": embed_result["vector_count"],
        "errors": embed_result["errors"][:5]
    }
    if not embed_result["valid"]:
        status["healthy"] = False
    
    # Check graph
    graph_path = MEMORY_DIR / "knowledge_graph.json"
    if graph_path.exists():
        try:
            with open(graph_path) as f:
                graph = json.load(f)
            status["checks"]["graph"] = {
                "valid": True,
                "nodes": len(graph.get("nodes", [])),
                "edges": len(graph.get("links", []))
            }
        except Exception as e:
            status["checks"]["graph"] = {"valid": False, "error": str(e)}
            status["healthy"] = False
    else:
        status["checks"]["graph"] = {"valid": False, "error": "Not found"}
    
    return status


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Memory system health checks")
    parser.add_argument("--health", action="store_true", help="Run full health check")
    parser.add_argument("--verify-ledger", action="store_true", help="Verify ledger integrity")
    parser.add_argument("--verify-embeddings", action="store_true", help="Verify embedding consistency")
    
    args = parser.parse_args()
    
    if args.health:
        result = memory_health_check()
        print(json.dumps(result, indent=2))
        if not result["healthy"]:
            exit(1)
    
    elif args.verify_ledger:
        valid, count, errors = verify_jsonl(MEMORY_DIR / "ledger.jsonl")
        print(f"Ledger: {count} events, {'valid' if valid else 'INVALID'}")
        for err in errors[:10]:
            print(f"  {err}")
    
    elif args.verify_embeddings:
        result = verify_embedding_integrity()
        print(json.dumps(result, indent=2))
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
