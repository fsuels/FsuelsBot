#!/usr/bin/env python3
"""
LLM-Based Entity and Relationship Extraction for OpenClaw
Replaces regex patterns with intelligent extraction.

Extracts:
- Entities (people, businesses, platforms, systems)
- Relationships (owns, has_problem, decided, depends_on, etc.)
- Canonical entity resolution (Francisco = Fsuels = francisco)

Usage:
    python extract_entities.py --text "Francisco said DLM has GMC issues"
    python extract_entities.py --update-graph  # Re-extract from ledger
"""

import argparse
import json
import os
import sys
from pathlib import Path

# Paths
WORKSPACE = Path(os.environ.get("CLAWD_WORKSPACE", Path.home() / "clawd"))
MEMORY_DIR = WORKSPACE / "memory"
LEDGER_PATH = MEMORY_DIR / "ledger.jsonl"
ENTITY_REGISTRY_PATH = MEMORY_DIR / "entity_registry.json"

# Learned alias mapping (loaded from memory/aliases.json)
ALIASES_PATH = MEMORY_DIR / "aliases.json"

def load_aliases() -> dict:
    """Load learned aliases from JSON file."""
    if ALIASES_PATH.exists():
        try:
            with open(ALIASES_PATH) as f:
                data = json.load(f)
                return data.get("aliases", {})
        except (json.JSONDecodeError, IOError):
            pass
    return {}

def save_alias(alias: str, canonical: str, entity_type: str = "unknown") -> None:
    """Learn a new alias mapping and persist it."""
    from datetime import datetime
    
    alias_lower = alias.lower().strip()
    if not alias_lower or not canonical:
        return
    
    # Load current data
    data = {"version": 1, "aliases": {}, "canonical_entities": {}, "learn_log": []}
    if ALIASES_PATH.exists():
        try:
            with open(ALIASES_PATH) as f:
                data = json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    
    # Check if already exists
    if alias_lower in data.get("aliases", {}):
        return
    
    # Add new alias
    data.setdefault("aliases", {})[alias_lower] = canonical
    data["updated_at"] = datetime.now().isoformat()
    
    # Ensure canonical entity exists
    if canonical not in data.get("canonical_entities", {}):
        data.setdefault("canonical_entities", {})[canonical] = {
            "type": entity_type,
            "first_seen": datetime.now().strftime("%Y-%m-%d")
        }
    
    # Log the learning
    data.setdefault("learn_log", []).append({
        "alias": alias_lower,
        "canonical": canonical,
        "learned_at": datetime.now().isoformat()
    })
    
    # Write atomically
    tmp_path = ALIASES_PATH.with_suffix(".tmp")
    with open(tmp_path, "w") as f:
        json.dump(data, f, indent=2)
    tmp_path.rename(ALIASES_PATH)

# Load aliases at module init (refreshed on each call)
def get_entity_aliases() -> dict:
    """Get current alias mappings."""
    return load_aliases()

EXTRACTION_PROMPT = """Extract entities, relationships, and alias equivalences from this text.

ENTITIES: People, businesses, platforms, systems, products mentioned.
RELATIONSHIPS: How entities relate (owns, has_problem, decided, depends_on, blocked_by, fixed, uses).
ALIASES: When you see two names refer to the same thing (e.g., "Francisco, also known as Fsuels").

Output JSON:
{{
  "entities": [
    {{"name": "Francisco", "type": "person"}},
    {{"name": "DLM", "type": "business"}}
  ],
  "relationships": [
    {{"subject": "Francisco", "predicate": "owns", "object": "DLM"}},
    {{"subject": "DLM", "predicate": "has_problem", "object": "GMC"}}
  ],
  "aliases": [
    {{"alias": "Fsuels", "canonical": "Francisco", "type": "person"}},
    {{"alias": "Dress Like Mommy", "canonical": "DLM", "type": "business"}}
  ]
}}

Rules:
- Use canonical names (DLM not "Dress Like Mommy", GMC not "Google Merchant Center")
- Only extract explicitly stated relationships, not inferences
- Include aliases when text explicitly mentions equivalence ("also known as", "aka", "=", or context makes clear)
- If no entities/relationships/aliases, return empty arrays

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
        print(f"LLM call failed: {e}", file=sys.stderr)
        return "{}"


def resolve_entity(name: str, learn_type: str = None) -> str:
    """Resolve entity name to canonical form using learned aliases."""
    name_lower = name.lower().strip()
    aliases = get_entity_aliases()
    
    canonical = aliases.get(name_lower)
    if canonical:
        return canonical
    
    # If not found but we have a type hint, we might learn this later
    # For now, return the original name (properly cased)
    return name.strip()


def extract_with_llm(text: str, learn_aliases: bool = True) -> dict:
    """Extract entities and relationships using LLM, optionally learning new aliases."""
    prompt = EXTRACTION_PROMPT.format(text=text[:2000])
    response = call_llm(prompt)
    
    # Parse JSON
    try:
        if "```json" in response:
            response = response.split("```json")[1].split("```")[0]
        elif "```" in response:
            response = response.split("```")[1].split("```")[0]
        
        data = json.loads(response.strip())
        
        # Learn new aliases before resolving
        if learn_aliases:
            for alias_entry in data.get("aliases", []):
                alias = alias_entry.get("alias", "")
                canonical = alias_entry.get("canonical", "")
                entity_type = alias_entry.get("type", "unknown")
                if alias and canonical:
                    save_alias(alias, canonical, entity_type)
        
        # Resolve entity names (now includes newly learned aliases)
        for entity in data.get("entities", []):
            entity["name"] = resolve_entity(entity["name"])
        
        for rel in data.get("relationships", []):
            rel["subject"] = resolve_entity(rel["subject"])
            rel["object"] = resolve_entity(rel["object"])
        
        return data
    except json.JSONDecodeError:
        return {"entities": [], "relationships": [], "aliases": []}


def extract_with_patterns(text: str) -> dict:
    """
    Fast pattern-based extraction (no LLM).
    Use for high-volume or when LLM unavailable.
    """
    import re
    
    # Entity patterns (expanded from knowledge_graph.py)
    patterns = {
        "person": r"\b(Francisco|Karina|Giselle|Amanda|Scott|Fsuels)\b",
        "business": r"\b(DLM|Dress Like Mommy|BuckyDrop|123LegalDoc|FKG Trading)\b",
        "platform": r"\b(Google Ads|Google Merchant Center|GMC|Microsoft Ads|TikTok|Pinterest|Facebook|Shopify|GA4|Stripe)\b",
        "system": r"\b(FsuelsBot|McSuels|OpenClaw|Clawdbot|Mission Control)\b",
    }
    
    entities = []
    seen = set()
    
    for entity_type, pattern in patterns.items():
        matches = re.findall(pattern, text, re.IGNORECASE)
        for match in matches:
            canonical = resolve_entity(match)
            if canonical not in seen:
                seen.add(canonical)
                entities.append({"name": canonical, "type": entity_type})
    
    # Simple relationship extraction based on keywords
    relationships = []
    text_lower = text.lower()
    
    relationship_keywords = {
        "owns": ["owns", "runs", "operates", "manages", "my"],
        "has_problem": ["problem", "issue", "suspended", "blocked", "broken", "error", "not working"],
        "decided": ["decided", "decision", "chose", "selected", "approved"],
        "depends_on": ["depends", "requires", "needs", "uses", "connected to"],
        "fixed": ["fixed", "resolved", "completed", "done", "working now"],
    }
    
    entity_names = [e["name"] for e in entities]
    
    for rel_type, keywords in relationship_keywords.items():
        for keyword in keywords:
            if keyword in text_lower and len(entity_names) >= 2:
                # Simple heuristic: connect first two entities
                relationships.append({
                    "subject": entity_names[0],
                    "predicate": rel_type,
                    "object": entity_names[1]
                })
                break
    
    return {"entities": entities, "relationships": relationships}


def extract_entities(text: str, use_llm: bool = True) -> dict:
    """
    Main extraction function.
    
    Args:
        text: Text to extract from
        use_llm: Use LLM (slower, more accurate) or patterns (fast, less accurate)
    """
    if use_llm:
        return extract_with_llm(text)
    else:
        return extract_with_patterns(text)


def load_entity_registry() -> dict:
    """Load or create entity registry."""
    if ENTITY_REGISTRY_PATH.exists():
        with open(ENTITY_REGISTRY_PATH) as f:
            return json.load(f)
    return {"entities": {}, "aliases": ENTITY_ALIASES}


def save_entity_registry(registry: dict):
    """Save entity registry."""
    with open(ENTITY_REGISTRY_PATH, "w") as f:
        json.dump(registry, f, indent=2)


def update_registry(extraction: dict, registry: dict):
    """Update registry with new entities."""
    for entity in extraction.get("entities", []):
        name = entity["name"]
        if name not in registry["entities"]:
            registry["entities"][name] = {
                "type": entity["type"],
                "first_seen": "now",
                "mention_count": 0
            }
        registry["entities"][name]["mention_count"] += 1


def main():
    parser = argparse.ArgumentParser(description="LLM entity extraction")
    parser.add_argument("--text", help="Text to extract from")
    parser.add_argument("--fast", action="store_true", help="Use pattern matching (no LLM)")
    parser.add_argument("--update-graph", action="store_true", help="Re-extract from ledger and rebuild graph")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    
    args = parser.parse_args()
    
    if args.text:
        result = extract_entities(args.text, use_llm=not args.fast)
        print(json.dumps(result, indent=2))
    
    elif args.update_graph:
        print("Re-extracting entities from ledger...")
        
        # Load ledger
        events = []
        with open(LEDGER_PATH, encoding='utf-8', errors='replace') as f:
            for line in f:
                try:
                    events.append(json.loads(line))
                except:
                    pass
        
        print(f"Processing {len(events)} events...")
        
        # Extract from each event (using fast mode for bulk)
        registry = load_entity_registry()
        all_entities = set()
        all_relationships = []
        
        for event in events:
            content = event.get("content", "")
            if content:
                extraction = extract_entities(content, use_llm=False)
                update_registry(extraction, registry)
                
                for e in extraction.get("entities", []):
                    all_entities.add((e["name"], e["type"]))
                
                for r in extraction.get("relationships", []):
                    r["event_id"] = event.get("id", "")
                    all_relationships.append(r)
        
        save_entity_registry(registry)
        
        print(f"Found {len(all_entities)} unique entities, {len(all_relationships)} relationships")
        print(f"Registry saved to {ENTITY_REGISTRY_PATH}")
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
