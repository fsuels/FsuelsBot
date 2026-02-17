#!/usr/bin/env python3
"""
Multi-scale Memory Hierarchy for OpenClaw
Based on RGMem (Alibaba) - Facts → Scenes → Persona

Coarse-graining: many small facts consolidate into themes,
themes consolidate into persona-level understanding.

Usage:
    python hierarchy.py --rebuild         # Build hierarchy from facts
    python hierarchy.py --facts "DLM"     # Show facts for entity
    python hierarchy.py --scenes          # Show consolidated scenes
    python hierarchy.py --persona         # Show persona-level insights
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from collections import defaultdict
from typing import Optional

# Paths
WORKSPACE = Path(os.environ.get("CLAWD_WORKSPACE", Path.home() / "clawd"))
MEMORY_DIR = WORKSPACE / "memory"
LEDGER_PATH = MEMORY_DIR / "ledger.jsonl"
HIERARCHY_PATH = MEMORY_DIR / "hierarchy.json"

# Scene categories (themes)
SCENE_CATEGORIES = {
    "business_operations": ["DLM", "Shopify", "BuckyDrop", "orders", "fulfillment", "inventory"],
    "marketing": ["Google Ads", "Facebook", "Pinterest", "TikTok", "SEO", "conversion", "pixel"],
    "technical": ["GMC", "API", "script", "code", "bug", "fix", "error"],
    "preferences": ["wants", "prefers", "likes", "values", "important"],
    "constraints": ["budget", "limit", "never", "always", "must", "constraint"],
    "relationships": ["Francisco", "Karina", "Giselle", "Amanda", "family"],
    "system": ["FsuelsBot", "McSuels", "OpenClaw", "memory", "agent"],
}


def load_ledger() -> list[dict]:
    """Load events from ledger."""
    events = []
    if LEDGER_PATH.exists():
        with open(LEDGER_PATH, encoding='utf-8', errors='replace') as f:
            for line in f:
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return events


def categorize_fact(content: str) -> str:
    """Categorize a fact into a scene."""
    content_lower = content.lower()
    
    for scene, keywords in SCENE_CATEGORIES.items():
        for keyword in keywords:
            if keyword.lower() in content_lower:
                return scene
    
    return "general"


def build_hierarchy(events: list[dict]) -> dict:
    """Build fact → scene → persona hierarchy."""
    
    # Layer 1: Facts (raw events grouped by entity)
    facts_by_entity = defaultdict(list)
    for event in events:
        entity = event.get("entity", "unknown")
        content = event.get("content", "")
        event_type = event.get("type", "fact")
        priority = event.get("priority", "P2")
        
        facts_by_entity[entity].append({
            "content": content[:500],
            "type": event_type,
            "priority": priority,
            "scene": categorize_fact(content)
        })
    
    # Layer 2: Scenes (facts grouped by theme)
    scenes = defaultdict(list)
    for entity, facts in facts_by_entity.items():
        for fact in facts:
            scene = fact["scene"]
            scenes[scene].append({
                "entity": entity,
                "content": fact["content"][:200],
                "priority": fact["priority"]
            })
    
    # Layer 3: Persona (high-level insights derived from scenes)
    persona = {}
    
    # Derive persona from preference/constraint facts
    preference_facts = [e for e in events if e.get("type") in ("preference", "constraint")]
    if preference_facts:
        persona["values"] = [f["content"][:150] for f in preference_facts[:10]]
    
    # Derive business focus from business_operations scene
    if scenes.get("business_operations"):
        entities = list(set(f["entity"] for f in scenes["business_operations"]))
        persona["business_focus"] = entities[:5]
    
    # Derive technical concerns from technical scene
    if scenes.get("technical"):
        persona["active_issues"] = [f["content"][:100] for f in scenes["technical"][:5]]
    
    # Derive relationships from relationships scene
    if scenes.get("relationships"):
        persona["key_relationships"] = list(set(f["entity"] for f in scenes["relationships"]))
    
    return {
        "facts_by_entity": {k: v[:20] for k, v in facts_by_entity.items()},  # Limit for storage
        "scenes": {k: v[:20] for k, v in scenes.items()},
        "persona": persona,
        "stats": {
            "total_facts": len(events),
            "entities": len(facts_by_entity),
            "scenes": len(scenes),
            "built_at": datetime.now().isoformat()
        }
    }


def save_hierarchy(hierarchy: dict):
    """Save hierarchy to file."""
    with open(HIERARCHY_PATH, "w") as f:
        json.dump(hierarchy, f, indent=2)
    print(f"Saved hierarchy: {hierarchy['stats']['entities']} entities, {hierarchy['stats']['scenes']} scenes", file=sys.stderr)


def load_hierarchy() -> Optional[dict]:
    """Load hierarchy from file."""
    if not HIERARCHY_PATH.exists():
        return None
    with open(HIERARCHY_PATH) as f:
        return json.load(f)


def main():
    parser = argparse.ArgumentParser(description="Memory hierarchy")
    parser.add_argument("--rebuild", action="store_true", help="Rebuild hierarchy")
    parser.add_argument("--facts", help="Show facts for entity")
    parser.add_argument("--scenes", action="store_true", help="Show scenes")
    parser.add_argument("--persona", action="store_true", help="Show persona")
    parser.add_argument("--all", action="store_true", help="Show all layers")
    
    args = parser.parse_args()
    
    if args.rebuild:
        events = load_ledger()
        print(f"Building hierarchy from {len(events)} events...", file=sys.stderr)
        hierarchy = build_hierarchy(events)
        save_hierarchy(hierarchy)
        return
    
    hierarchy = load_hierarchy()
    if not hierarchy:
        print("No hierarchy found. Run --rebuild first.", file=sys.stderr)
        sys.exit(1)
    
    if args.facts:
        facts = hierarchy["facts_by_entity"].get(args.facts, [])
        print(f"Facts for {args.facts}:")
        for f in facts:
            print(f"  [{f['priority']}] ({f['scene']}): {f['content'][:80]}...")
    
    elif args.scenes:
        print("Scenes:")
        for scene, facts in hierarchy["scenes"].items():
            print(f"\n  {scene.upper()} ({len(facts)} facts):")
            for f in facts[:3]:
                print(f"    - [{f['entity']}]: {f['content'][:60]}...")
    
    elif args.persona:
        print("Persona-level insights:")
        persona = hierarchy.get("persona", {})
        
        if persona.get("values"):
            print("\n  VALUES/CONSTRAINTS:")
            for v in persona["values"]:
                print(f"    - {v}")
        
        if persona.get("business_focus"):
            print(f"\n  BUSINESS FOCUS: {', '.join(persona['business_focus'])}")
        
        if persona.get("active_issues"):
            print("\n  ACTIVE ISSUES:")
            for issue in persona["active_issues"]:
                print(f"    - {issue}")
        
        if persona.get("key_relationships"):
            print(f"\n  KEY RELATIONSHIPS: {', '.join(persona['key_relationships'])}")
    
    elif args.all:
        print(json.dumps(hierarchy, indent=2))
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
