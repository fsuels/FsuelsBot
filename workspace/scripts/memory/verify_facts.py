#!/usr/bin/env python3
"""
Dual-Agent Fact Verification for OpenClaw
Based on Bi-Mem paper - verify facts against existing memory before storing.

Prevents hallucination accumulation by checking:
1. Does this contradict existing facts?
2. Is this a duplicate?
3. Is this actually a fact vs opinion?

Usage:
    python verify_facts.py --check "fact to verify"
    python verify_facts.py --batch facts.jsonl  # Verify batch
"""

import argparse
import json
import os
import sys
from pathlib import Path
from datetime import datetime

# Paths
WORKSPACE = Path(os.environ.get("CLAWD_WORKSPACE", Path.home() / "clawd"))
MEMORY_DIR = WORKSPACE / "memory"
LEDGER_PATH = MEMORY_DIR / "ledger.jsonl"

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent))


def load_existing_facts() -> list[dict]:
    """Load existing facts from ledger."""
    facts = []
    if LEDGER_PATH.exists():
        with open(LEDGER_PATH, encoding='utf-8', errors='replace') as f:
            for line in f:
                try:
                    facts.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return facts


def check_contradiction(new_fact: str, existing_facts: list[dict]) -> dict:
    """Check if new fact contradicts existing facts."""
    # Simple heuristic checks
    contradictions = []
    new_lower = new_fact.lower()
    
    # Look for opposite statements
    negation_pairs = [
        ("is suspended", "is not suspended"),
        ("is working", "is broken"),
        ("is fixed", "is broken"),
        ("completed", "not completed"),
        ("enabled", "disabled"),
    ]
    
    for existing in existing_facts:
        existing_content = existing.get("content", "").lower()
        
        # Check for direct contradictions
        for pos, neg in negation_pairs:
            if pos in new_lower and neg in existing_content:
                contradictions.append({
                    "type": "negation",
                    "existing": existing.get("content", "")[:100],
                    "existing_id": existing.get("id")
                })
            elif neg in new_lower and pos in existing_content:
                contradictions.append({
                    "type": "negation", 
                    "existing": existing.get("content", "")[:100],
                    "existing_id": existing.get("id")
                })
    
    return {
        "has_contradiction": len(contradictions) > 0,
        "contradictions": contradictions[:3]  # Limit
    }


def check_duplicate(new_fact: str, existing_facts: list[dict]) -> dict:
    """Check if new fact is duplicate of existing."""
    new_lower = new_fact.lower()
    
    # Simple similarity: word overlap
    new_words = set(new_lower.split())
    
    duplicates = []
    for existing in existing_facts:
        existing_content = existing.get("content", "").lower()
        existing_words = set(existing_content.split())
        
        if not existing_words:
            continue
        
        overlap = len(new_words & existing_words) / len(new_words | existing_words)
        
        if overlap > 0.7:  # High similarity
            duplicates.append({
                "similarity": round(overlap, 2),
                "existing": existing.get("content", "")[:100],
                "existing_id": existing.get("id")
            })
    
    # Sort by similarity
    duplicates.sort(key=lambda x: x["similarity"], reverse=True)
    
    return {
        "is_duplicate": len(duplicates) > 0 and duplicates[0]["similarity"] > 0.8,
        "similar_facts": duplicates[:3]
    }


def check_factuality(fact: str) -> dict:
    """Check if statement appears to be a fact vs opinion."""
    fact_lower = fact.lower()
    
    # Opinion indicators
    opinion_words = ["i think", "maybe", "probably", "might", "could be", "seems like", "i feel"]
    
    is_opinion = any(word in fact_lower for word in opinion_words)
    
    # Fact indicators
    fact_words = ["is", "are", "was", "were", "has", "have", "did", "does"]
    has_fact_structure = any(word in fact_lower for word in fact_words)
    
    return {
        "appears_factual": has_fact_structure and not is_opinion,
        "is_opinion": is_opinion
    }


def verify_fact(fact: str, existing_facts: list[dict]) -> dict:
    """Full verification of a fact."""
    contradiction = check_contradiction(fact, existing_facts)
    duplicate = check_duplicate(fact, existing_facts)
    factuality = check_factuality(fact)
    
    # Overall verdict
    should_store = (
        not contradiction["has_contradiction"] and
        not duplicate["is_duplicate"] and
        factuality["appears_factual"]
    )
    
    issues = []
    if contradiction["has_contradiction"]:
        issues.append("contradicts existing facts")
    if duplicate["is_duplicate"]:
        issues.append("duplicate of existing")
    if not factuality["appears_factual"]:
        issues.append("appears to be opinion not fact")
    
    return {
        "fact": fact[:200],
        "verified": should_store,
        "issues": issues,
        "details": {
            "contradiction": contradiction,
            "duplicate": duplicate,
            "factuality": factuality
        }
    }


def main():
    parser = argparse.ArgumentParser(description="Verify facts before storing")
    parser.add_argument("--check", help="Verify a single fact")
    parser.add_argument("--batch", help="Verify batch from JSONL file")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    
    args = parser.parse_args()
    
    existing = load_existing_facts()
    print(f"Loaded {len(existing)} existing facts for comparison", file=sys.stderr)
    
    if args.check:
        result = verify_fact(args.check, existing)
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            status = "✓ VERIFIED" if result["verified"] else "✗ REJECTED"
            print(f"{status}: {args.check[:80]}...")
            if result["issues"]:
                print(f"  Issues: {', '.join(result['issues'])}")
    
    elif args.batch:
        batch_path = Path(args.batch)
        if not batch_path.exists():
            print(f"File not found: {args.batch}", file=sys.stderr)
            sys.exit(1)
        
        results = []
        with open(batch_path) as f:
            for line in f:
                try:
                    item = json.loads(line)
                    fact = item.get("content", "")
                    result = verify_fact(fact, existing)
                    results.append(result)
                except json.JSONDecodeError:
                    continue
        
        verified = sum(1 for r in results if r["verified"])
        print(f"Verified: {verified}/{len(results)}")
        
        if args.json:
            print(json.dumps(results, indent=2))
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
