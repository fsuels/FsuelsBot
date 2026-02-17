#!/usr/bin/env python3
"""
Three-Stage Entity Pipeline for OpenClaw Memory
Based on LLM Arena Round 2 learnings.

Stage 1: EXTRACTION - LLM extracts entities with confidence scores
Stage 2: LINKING - Probabilistic matching to existing entities
         >0.8 = auto-link, 0.5-0.8 = human review queue, <0.5 = new entity
Stage 3: CONSOLIDATION - Batch merge of discovered duplicates

Usage:
    python entity_pipeline.py --text "Extract entities from this"
    python entity_pipeline.py --review  # Process review queue
    python entity_pipeline.py --consolidate  # Run batch merge
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from difflib import SequenceMatcher
from typing import Optional, Tuple, List, Dict

# Paths
WORKSPACE = Path(os.environ.get("CLAWD_WORKSPACE", Path.home() / "clawd"))
MEMORY_DIR = WORKSPACE / "memory"
ALIASES_PATH = MEMORY_DIR / "aliases.json"
REVIEW_QUEUE_PATH = MEMORY_DIR / "entity_review_queue.json"
ENTITY_LOG_PATH = MEMORY_DIR / "entity_pipeline_log.jsonl"

# Thresholds
AUTO_LINK_THRESHOLD = 0.8
REVIEW_THRESHOLD = 0.5


def load_aliases() -> dict:
    """Load canonical entities and aliases."""
    if ALIASES_PATH.exists():
        with open(ALIASES_PATH) as f:
            return json.load(f)
    return {"aliases": {}, "canonical_entities": {}}


def save_aliases(data: dict) -> None:
    """Atomically save aliases."""
    data["updated_at"] = datetime.now().isoformat()
    tmp = ALIASES_PATH.with_suffix(".tmp")
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    tmp.rename(ALIASES_PATH)


def load_review_queue() -> list:
    """Load pending review items."""
    if REVIEW_QUEUE_PATH.exists():
        with open(REVIEW_QUEUE_PATH) as f:
            return json.load(f)
    return []


def save_review_queue(queue: list) -> None:
    """Save review queue."""
    tmp = REVIEW_QUEUE_PATH.with_suffix(".tmp")
    with open(tmp, "w") as f:
        json.dump(queue, f, indent=2)
    tmp.rename(REVIEW_QUEUE_PATH)


def log_event(event: dict) -> None:
    """Append event to pipeline log."""
    event["timestamp"] = datetime.now().isoformat()
    with open(ENTITY_LOG_PATH, "a") as f:
        f.write(json.dumps(event) + "\n")


# =============================================================================
# STAGE 1: EXTRACTION
# =============================================================================

EXTRACTION_PROMPT = """Extract all entities from this text with confidence scores.

For each entity:
- name: The entity's name as mentioned
- type: person, business, platform, system, product, or location
- confidence: 0.0-1.0 how certain you are this is a real entity (not a generic term)
- context: Brief note about why/where it was mentioned

Output JSON:
{{
  "entities": [
    {{"name": "Francisco", "type": "person", "confidence": 0.95, "context": "owner mentioned"}},
    {{"name": "DLM", "type": "business", "confidence": 0.9, "context": "business being discussed"}}
  ]
}}

Rules:
- Confidence 0.9+ for proper nouns clearly referring to specific entities
- Confidence 0.7-0.9 for likely entities with some ambiguity
- Confidence 0.5-0.7 for possible entities
- Skip generic terms like "the company" or "that person"

TEXT:
{text}

JSON:"""


def call_llm(prompt: str) -> str:
    """Call LLM for extraction."""
    try:
        import anthropic
        client = anthropic.Anthropic()
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}]
        )
        return response.content[0].text
    except Exception as e:
        print(f"LLM error: {e}", file=sys.stderr)
        return "{}"


def extract_entities(text: str) -> List[dict]:
    """Stage 1: Extract entities with confidence scores."""
    prompt = EXTRACTION_PROMPT.format(text=text[:2000])
    response = call_llm(prompt)
    
    try:
        if "```json" in response:
            response = response.split("```json")[1].split("```")[0]
        elif "```" in response:
            response = response.split("```")[1].split("```")[0]
        
        data = json.loads(response.strip())
        entities = data.get("entities", [])
        
        # Log extraction
        log_event({
            "stage": "extraction",
            "input_length": len(text),
            "entities_found": len(entities)
        })
        
        return entities
    except json.JSONDecodeError:
        return []


# =============================================================================
# STAGE 2: LINKING
# =============================================================================

def similarity_score(s1: str, s2: str) -> float:
    """Compute similarity between two strings."""
    return SequenceMatcher(None, s1.lower(), s2.lower()).ratio()


def find_best_match(entity_name: str, aliases_data: dict) -> Tuple[Optional[str], float]:
    """Find best matching canonical entity."""
    name_lower = entity_name.lower().strip()
    best_match = None
    best_score = 0.0
    
    # Direct alias lookup
    if name_lower in aliases_data.get("aliases", {}):
        return aliases_data["aliases"][name_lower], 1.0
    
    # Check against canonical entities
    for canonical in aliases_data.get("canonical_entities", {}):
        score = similarity_score(entity_name, canonical)
        if score > best_score:
            best_score = score
            best_match = canonical
    
    # Check against all aliases
    for alias, canonical in aliases_data.get("aliases", {}).items():
        score = similarity_score(entity_name, alias)
        if score > best_score:
            best_score = score
            best_match = canonical
    
    return best_match, best_score


def link_entities(entities: List[dict]) -> dict:
    """
    Stage 2: Link extracted entities to canonical forms.
    Returns: {auto_linked: [], needs_review: [], new_entities: []}
    """
    aliases_data = load_aliases()
    review_queue = load_review_queue()
    
    result = {
        "auto_linked": [],
        "needs_review": [],
        "new_entities": []
    }
    
    for entity in entities:
        name = entity.get("name", "")
        entity_type = entity.get("type", "unknown")
        confidence = entity.get("confidence", 0.5)
        
        best_match, match_score = find_best_match(name, aliases_data)
        
        if match_score >= AUTO_LINK_THRESHOLD:
            # Auto-link: high confidence match
            result["auto_linked"].append({
                "extracted": name,
                "canonical": best_match,
                "score": match_score
            })
            # Learn alias if it's a new form
            if name.lower().strip() not in aliases_data.get("aliases", {}):
                aliases_data.setdefault("aliases", {})[name.lower().strip()] = best_match
        
        elif match_score >= REVIEW_THRESHOLD:
            # Needs review: possible match
            review_item = {
                "extracted": name,
                "type": entity_type,
                "best_match": best_match,
                "score": match_score,
                "extraction_confidence": confidence,
                "added_at": datetime.now().isoformat()
            }
            result["needs_review"].append(review_item)
            
            # Add to review queue if not already there
            if not any(r.get("extracted", "").lower() == name.lower() for r in review_queue):
                review_queue.append(review_item)
        
        else:
            # New entity: no good match
            result["new_entities"].append({
                "name": name,
                "type": entity_type,
                "confidence": confidence
            })
            # Auto-add if high extraction confidence
            if confidence >= 0.8:
                aliases_data.setdefault("canonical_entities", {})[name] = {
                    "type": entity_type,
                    "first_seen": datetime.now().strftime("%Y-%m-%d"),
                    "auto_added": True
                }
    
    # Persist changes
    save_aliases(aliases_data)
    save_review_queue(review_queue)
    
    # Log linking
    log_event({
        "stage": "linking",
        "auto_linked": len(result["auto_linked"]),
        "needs_review": len(result["needs_review"]),
        "new_entities": len(result["new_entities"])
    })
    
    return result


# =============================================================================
# STAGE 3: CONSOLIDATION
# =============================================================================

def find_duplicate_candidates(aliases_data: dict) -> List[Tuple[str, str, float]]:
    """Find potential duplicate canonical entities."""
    canonicals = list(aliases_data.get("canonical_entities", {}).keys())
    candidates = []
    
    for i, e1 in enumerate(canonicals):
        for e2 in canonicals[i+1:]:
            score = similarity_score(e1, e2)
            if score >= 0.7:  # Potential duplicate
                candidates.append((e1, e2, score))
    
    return sorted(candidates, key=lambda x: -x[2])


def consolidate_entities(dry_run: bool = True) -> dict:
    """
    Stage 3: Find and merge duplicate entities.
    With dry_run=True, only reports candidates without merging.
    """
    aliases_data = load_aliases()
    duplicates = find_duplicate_candidates(aliases_data)
    
    result = {
        "candidates": duplicates,
        "merged": []
    }
    
    if not dry_run and duplicates:
        # Auto-merge high-confidence duplicates (>0.9)
        for e1, e2, score in duplicates:
            if score >= 0.9:
                # Keep the shorter name as canonical
                keep, merge = (e1, e2) if len(e1) <= len(e2) else (e2, e1)
                
                # Add merge as alias
                aliases_data.setdefault("aliases", {})[merge.lower()] = keep
                
                # Remove from canonical entities
                if merge in aliases_data.get("canonical_entities", {}):
                    del aliases_data["canonical_entities"][merge]
                
                # Update any aliases pointing to merged entity
                for alias, canonical in list(aliases_data.get("aliases", {}).items()):
                    if canonical == merge:
                        aliases_data["aliases"][alias] = keep
                
                result["merged"].append({
                    "kept": keep,
                    "merged": merge,
                    "score": score
                })
        
        save_aliases(aliases_data)
    
    log_event({
        "stage": "consolidation",
        "candidates_found": len(duplicates),
        "auto_merged": len(result["merged"]),
        "dry_run": dry_run
    })
    
    return result


# =============================================================================
# CLI
# =============================================================================

def run_pipeline(text: str) -> dict:
    """Run full three-stage pipeline."""
    print("Stage 1: Extraction...", file=sys.stderr)
    entities = extract_entities(text)
    
    print(f"Stage 2: Linking {len(entities)} entities...", file=sys.stderr)
    link_result = link_entities(entities)
    
    return {
        "extracted": entities,
        "linking": link_result
    }


def main():
    parser = argparse.ArgumentParser(description="Entity Pipeline")
    parser.add_argument("--text", help="Text to extract from")
    parser.add_argument("--review", action="store_true", help="Show review queue")
    parser.add_argument("--consolidate", action="store_true", help="Find duplicates")
    parser.add_argument("--merge", action="store_true", help="Actually merge duplicates")
    args = parser.parse_args()
    
    if args.review:
        queue = load_review_queue()
        print(json.dumps(queue, indent=2))
    elif args.consolidate:
        result = consolidate_entities(dry_run=not args.merge)
        print(json.dumps(result, indent=2))
    elif args.text:
        result = run_pipeline(args.text)
        print(json.dumps(result, indent=2))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
