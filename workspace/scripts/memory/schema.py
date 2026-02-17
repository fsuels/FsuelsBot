#!/usr/bin/env python3
"""
Memory Schema Validation for OpenClaw
Pydantic models for ledger events and other memory structures.

Usage:
    from schema import LedgerEvent, validate_event
    
    # Validate single event
    event = validate_event({"type": "fact", "content": "..."})
    
    # Validate entire ledger
    python schema.py --validate-ledger
"""

import json
import sys
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Optional

try:
    from pydantic import BaseModel, Field, field_validator
except ImportError:
    print("Error: pydantic not installed. Run: pip install pydantic", file=sys.stderr)
    sys.exit(1)

# Paths
WORKSPACE = Path.home() / "clawd"
MEMORY_DIR = WORKSPACE / "memory"
LEDGER_PATH = MEMORY_DIR / "ledger.jsonl"


class EventType(str, Enum):
    FACT = "fact"
    PREFERENCE = "preference"
    DECISION = "decision"
    CONSTRAINT = "constraint"
    COMMITMENT = "commitment"
    MILESTONE = "milestone"
    RELATIONSHIP = "relationship"
    INSIGHT = "insight"


class Priority(str, Enum):
    P0 = "P0"
    P1 = "P1"
    P2 = "P2"
    P3 = "P3"


class TrustLevel(str, Enum):
    VERIFIED = "verified"
    INTERNAL = "internal"
    EXTERNAL = "external"


class MemoryTier(str, Enum):
    """
    Hybrid tier architecture (Arena Round 2 learning):
    - HOT: Context-stuffed into pack.md, always available
    - WARM: RAG retrieval for older relevant content
    - COLD: Archived, rarely accessed
    """
    HOT = "hot"
    WARM = "warm"
    COLD = "cold"


class LedgerEvent(BaseModel):
    """Schema for ledger.jsonl events."""
    
    ts: str = Field(..., description="ISO timestamp")
    id: str = Field(..., pattern=r"^EVT-\d{8}-[a-f0-9]{6}$", description="Event ID")
    type: EventType = Field(default=EventType.FACT)
    priority: Priority = Field(default=Priority.P2)
    content: str = Field(..., min_length=1, max_length=5000)
    entity: str = Field(default="unknown")
    tags: list[str] = Field(default_factory=list)
    source: str = Field(default="unknown")
    session: Optional[str] = None
    trust_level: TrustLevel = Field(default=TrustLevel.INTERNAL)
    tier: MemoryTier = Field(default=MemoryTier.WARM, description="Hot/Warm/Cold tier")
    
    @field_validator('ts')
    @classmethod
    def validate_timestamp(cls, v):
        """Validate ISO timestamp format."""
        try:
            # Try parsing the timestamp
            if 'T' in v:
                datetime.fromisoformat(v.replace('Z', '+00:00'))
            return v
        except ValueError:
            raise ValueError(f"Invalid timestamp format: {v}")
    
    @field_validator('content')
    @classmethod
    def validate_content(cls, v):
        """Ensure content is not just whitespace."""
        if not v.strip():
            raise ValueError("Content cannot be empty or whitespace")
        return v


class EmbeddingEntry(BaseModel):
    """Schema for embedding index entries."""
    
    id: str
    content: str
    type: str = "fact"
    priority: str = "P2"
    source: str = "unknown"
    ts: str = ""
    vector_idx: int = Field(..., ge=0)


def validate_event(data: dict) -> LedgerEvent:
    """Validate a single event dict against schema."""
    return LedgerEvent(**data)


def validate_ledger(path: Path = LEDGER_PATH) -> tuple[int, list[dict]]:
    """
    Validate entire ledger file.
    Returns (valid_count, list of errors).
    """
    if not path.exists():
        return 0, [{"line": 0, "error": f"Ledger not found: {path}"}]
    
    valid = 0
    errors = []
    
    with open(path, encoding='utf-8', errors='replace') as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            
            try:
                data = json.loads(line)
            except json.JSONDecodeError as e:
                errors.append({"line": i, "error": f"Invalid JSON: {e}"})
                continue
            
            try:
                validate_event(data)
                valid += 1
            except Exception as e:
                errors.append({
                    "line": i, 
                    "error": str(e),
                    "event_id": data.get("id", "unknown")
                })
    
    return valid, errors


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Memory schema validation")
    parser.add_argument("--validate-ledger", action="store_true", help="Validate ledger.jsonl")
    parser.add_argument("--validate-event", help="Validate JSON string")
    parser.add_argument("--strict", action="store_true", help="Exit with error if any validation fails")
    
    args = parser.parse_args()
    
    if args.validate_event:
        try:
            data = json.loads(args.validate_event)
            event = validate_event(data)
            print(f"✓ Valid event: {event.id}")
            print(event.model_dump_json(indent=2))
        except Exception as e:
            print(f"✗ Invalid: {e}", file=sys.stderr)
            sys.exit(1)
    
    elif args.validate_ledger:
        print(f"Validating {LEDGER_PATH}...")
        valid, errors = validate_ledger()
        
        print(f"\nResults: {valid} valid events, {len(errors)} errors")
        
        if errors:
            print("\nErrors:")
            for err in errors[:20]:  # Show first 20
                print(f"  Line {err['line']}: {err['error']}")
            if len(errors) > 20:
                print(f"  ... and {len(errors) - 20} more")
        
        if args.strict and errors:
            sys.exit(1)
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
