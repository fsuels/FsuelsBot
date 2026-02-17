#!/usr/bin/env python3
"""
Fact Extraction Pipeline for OpenClaw Memory System
Based on Mem0/research best practices: LLM extracts facts from conversations.

Usage:
    python extract_facts.py --session <session_file>
    python extract_facts.py --text "conversation text"
    python extract_facts.py --stdin  # Read from stdin

Outputs facts to memory/extracted/ as JSONL files.
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
import subprocess
import hashlib

# Paths
WORKSPACE = Path(os.environ.get("CLAWD_WORKSPACE", Path.home() / "clawd"))
MEMORY_DIR = WORKSPACE / "memory"
EXTRACTED_DIR = MEMORY_DIR / "extracted"
LEDGER_PATH = MEMORY_DIR / "ledger.jsonl"

# Ensure directories exist
EXTRACTED_DIR.mkdir(parents=True, exist_ok=True)

EXTRACTION_PROMPT = """You are a fact extraction system. Extract important facts, preferences, decisions, and relationships from this conversation.

Rules:
1. Extract ONLY explicitly stated information, not inferences
2. Use present tense for current facts, past tense for completed events
3. Include WHO said/decided something when relevant
4. Capture preferences, constraints, and decisions with high priority
5. Skip small talk, acknowledgments, and routine exchanges
6. Each fact should be self-contained (understandable without context)

Output JSON array of facts. Each fact has these fields:
- "type": one of fact, preference, decision, relationship, commitment, constraint, milestone
- "content": The extracted information in one clear sentence
- "entity": primary entity this relates to (person, project, or system)
- "priority": P0 (critical), P1 (important), or P2 (nice-to-know)
- "tags": array of relevant tags

Priority guide:
- P0: Core identity, critical constraints, standing orders
- P1: Important business/personal facts, active commitments
- P2: Nice-to-know, background context

If no facts worth extracting, return empty array: []

---
CONVERSATION:
{conversation}
---

Extract facts as JSON array:"""


def call_claude_via_delegate(prompt: str) -> str:
    """Call Claude using OpenClaw's delegate pattern (fast/cheap model)."""
    # Use subprocess to call openclaw CLI if available, otherwise fall back to API
    try:
        # Try using the gateway's internal delegate
        result = subprocess.run(
            ["openclaw", "delegate", "--task", prompt],
            capture_output=True,
            text=True,
            timeout=60
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    
    # Fallback: Use Anthropic API directly if available
    try:
        import anthropic
        client = anthropic.Anthropic()
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}]
        )
        return response.content[0].text
    except ImportError:
        print("Error: anthropic package not installed. Run: pip install anthropic", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error calling Claude: {e}", file=sys.stderr)
        sys.exit(1)


def extract_facts(conversation: str) -> list[dict]:
    """Extract facts from conversation using LLM."""
    prompt = EXTRACTION_PROMPT.format(conversation=conversation)
    response = call_claude_via_delegate(prompt)
    
    # Parse JSON from response
    try:
        # Handle markdown code blocks
        if "```json" in response:
            response = response.split("```json")[1].split("```")[0]
        elif "```" in response:
            response = response.split("```")[1].split("```")[0]
        
        facts = json.loads(response.strip())
        if not isinstance(facts, list):
            facts = [facts]
        return facts
    except json.JSONDecodeError as e:
        print(f"Warning: Could not parse LLM response as JSON: {e}", file=sys.stderr)
        print(f"Response was: {response[:500]}", file=sys.stderr)
        return []


def generate_event_id() -> str:
    """Generate unique event ID."""
    now = datetime.now()
    date_str = now.strftime("%Y%m%d")
    # Use timestamp + random for uniqueness
    hash_input = f"{now.isoformat()}-{os.urandom(4).hex()}"
    short_hash = hashlib.sha256(hash_input.encode()).hexdigest()[:6]
    return f"EVT-{date_str}-{short_hash}"


def infer_trust_level(source: str) -> str:
    """
    Infer trust level from source.
    
    Levels:
    - verified: Human-confirmed facts (manual entry, Francisco)
    - internal: System-generated facts (bot observations, tool outputs)
    - external: External data (web scrapes, API responses, uploaded files)
    """
    source_lower = source.lower()
    
    # External sources
    if any(x in source_lower for x in ["web:", "scrape:", "fetch:", "url:", "http", "api:"]):
        return "external"
    
    # Verified sources (human input)
    if any(x in source_lower for x in ["manual", "francisco", "human", "verified"]):
        return "verified"
    
    # Default to internal
    return "internal"


def format_as_ledger_events(facts: list[dict], source: str) -> list[dict]:
    """Convert extracted facts to ledger event format."""
    events = []
    now = datetime.now().astimezone()
    trust_level = infer_trust_level(source)
    
    for fact in facts:
        event = {
            "ts": now.isoformat(),
            "id": generate_event_id(),
            "type": fact.get("type", "fact"),
            "priority": fact.get("priority", "P2"),
            "content": fact.get("content", ""),
            "entity": fact.get("entity", "unknown"),
            "tags": fact.get("tags", []) + ["auto-extracted"],
            "source": source,
            "session": "auto-extraction",
            "trust_level": trust_level
        }
        events.append(event)
    
    return events


def check_duplicate(content: str, threshold: float = 0.85) -> tuple:
    """
    Check if content is duplicate of existing memory.
    Returns (is_duplicate, existing_content if duplicate).
    
    Uses embedding similarity check (CrewAI pattern - 85% threshold).
    """
    try:
        sys.path.insert(0, str(Path(__file__).parent))
        from embed_memories import search, load_index
        
        # Check if embeddings exist
        index, _ = load_index()
        if index is None:
            return False, None
        
        # Search for similar content
        results = search(content, top_k=3)
        
        for result in results:
            score = result.get("score", 0)
            if score >= threshold:
                return True, result.get("content", "")[:100]
        
        return False, None
    except Exception as e:
        # If embedding check fails, allow the write
        print(f"Warning: Duplicate check failed: {e}", file=sys.stderr)
        return False, None


def append_to_ledger(events: list[dict], dedup: bool = True, dedup_threshold: float = 0.85, cove: bool = False, cove_min_confidence: float = 0.7):
    """
    Append events to the main ledger with validation and atomic writes.
    
    Args:
        events: Events to append
        dedup: Whether to check for duplicates
        dedup_threshold: Similarity threshold for dedup (0-1)
        cove: Whether to run Chain-of-Verification
        cove_min_confidence: Minimum confidence for CoVe verification (0-1)
    """
    # Import safe I/O and schema validation
    try:
        from safe_io import atomic_append
        from schema import validate_event
        use_safe_io = True
    except ImportError:
        use_safe_io = False
    
    # CoVe verification if enabled
    if cove:
        try:
            from chain_of_verification import verify_facts_batch
            print(f"Running Chain-of-Verification on {len(events)} facts...", file=sys.stderr)
            events = verify_facts_batch(events, cove_min_confidence)
            print(f"CoVe passed: {len(events)} facts verified", file=sys.stderr)
        except ImportError:
            print("Warning: CoVe module not available, skipping verification", file=sys.stderr)
        except Exception as e:
            print(f"Warning: CoVe failed: {e}, proceeding without verification", file=sys.stderr)
    
    added = 0
    skipped = 0
    validation_errors = 0
    
    for event in events:
        content = event.get("content", "")
        
        # Dedup check
        if dedup and content:
            is_dup, existing = check_duplicate(content, dedup_threshold)
            if is_dup:
                print(f"Skipping duplicate: '{content[:50]}...' ≈ '{existing}...'", file=sys.stderr)
                skipped += 1
                continue
        
        # Schema validation
        if use_safe_io:
            try:
                validate_event(event)
            except Exception as e:
                print(f"Validation error: {e}", file=sys.stderr)
                validation_errors += 1
                continue
        
        # Write (atomic if available)
        line = json.dumps(event)
        if use_safe_io:
            atomic_append(LEDGER_PATH, line)
        else:
            with open(LEDGER_PATH, "a") as f:
                f.write(line + "\n")
        added += 1
    
    print(f"Appended {added} events to ledger ({skipped} duplicates, {validation_errors} validation errors)", file=sys.stderr)


def save_extraction_batch(events: list[dict], source: str):
    """Save extraction batch to extracted/ directory for review."""
    now = datetime.now()
    filename = f"{now.strftime('%Y-%m-%d_%H%M%S')}_{hashlib.sha256(source.encode()).hexdigest()[:8]}.jsonl"
    filepath = EXTRACTED_DIR / filename
    
    with open(filepath, "w") as f:
        for event in events:
            f.write(json.dumps(event) + "\n")
    
    print(f"Saved extraction batch to {filepath}", file=sys.stderr)
    return filepath


def read_session_transcript(session_path: str) -> str:
    """Read and format a session transcript."""
    path = Path(session_path)
    if not path.exists():
        print(f"Error: Session file not found: {session_path}", file=sys.stderr)
        sys.exit(1)
    
    lines = []
    with open(path, encoding='utf-8', errors='replace') as f:
        for line in f:
            try:
                entry = json.loads(line)
                
                # Handle OpenClaw session format (type: "message" with nested message object)
                if entry.get("type") == "message":
                    msg = entry.get("message", {})
                    role = msg.get("role", "unknown")
                    content = msg.get("content", "")
                else:
                    # Fallback for simple format
                    role = entry.get("role", "")
                    content = entry.get("content", "")
                
                if not role:
                    continue
                    
                # Handle multi-part content (list of content blocks)
                if isinstance(content, list):
                    text_parts = []
                    for p in content:
                        if isinstance(p, dict):
                            if p.get("type") == "text":
                                text_parts.append(p.get("text", ""))
                            # Skip thinking blocks
                    content = " ".join(text_parts)
                
                if content and content.strip():
                    # Skip system/internal messages
                    if role in ("user", "assistant"):
                        lines.append(f"{role}: {content[:2000]}")  # Truncate long messages
            except json.JSONDecodeError:
                continue
    
    return "\n\n".join(lines[-50:])  # Last 50 messages max


def main():
    parser = argparse.ArgumentParser(description="Extract facts from conversations")
    parser.add_argument("--session", help="Path to session transcript JSONL file")
    parser.add_argument("--text", help="Direct conversation text")
    parser.add_argument("--stdin", action="store_true", help="Read from stdin")
    parser.add_argument("--dry-run", action="store_true", help="Don't append to ledger")
    parser.add_argument("--no-dedup", action="store_true", help="Skip duplicate checking")
    parser.add_argument("--dedup-threshold", type=float, default=0.85, help="Similarity threshold for dedup (0-1)")
    parser.add_argument("--cove", action="store_true", help="Enable Chain-of-Verification (reduces hallucinations)")
    parser.add_argument("--cove-confidence", type=float, default=0.7, help="Minimum CoVe confidence (0-1)")
    parser.add_argument("--source", default="manual", help="Source identifier")
    
    args = parser.parse_args()
    
    # Get conversation text
    if args.session:
        conversation = read_session_transcript(args.session)
        source = f"session:{Path(args.session).stem}"
    elif args.text:
        conversation = args.text
        source = args.source
    elif args.stdin:
        conversation = sys.stdin.read()
        source = args.source
    else:
        parser.print_help()
        sys.exit(1)
    
    if not conversation.strip():
        print("No conversation content to extract from", file=sys.stderr)
        sys.exit(0)
    
    print(f"Extracting facts from {len(conversation)} chars...", file=sys.stderr)
    
    # Extract facts
    facts = extract_facts(conversation)
    
    if not facts:
        print("No facts extracted", file=sys.stderr)
        sys.exit(0)
    
    print(f"Extracted {len(facts)} facts", file=sys.stderr)
    
    # Convert to ledger format
    events = format_as_ledger_events(facts, source)
    
    # Save batch for review
    batch_path = save_extraction_batch(events, source)
    
    # Append to ledger unless dry-run
    if not args.dry_run:
        append_to_ledger(
            events, 
            dedup=not args.no_dedup,
            dedup_threshold=args.dedup_threshold,
            cove=args.cove,
            cove_min_confidence=args.cove_confidence
        )
    else:
        print("Dry run - not appending to ledger", file=sys.stderr)
    
    # Output events as JSON for pipeline integration
    print(json.dumps(events, indent=2))


if __name__ == "__main__":
    main()
