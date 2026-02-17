#!/usr/bin/env python3
"""
Recall Pack Generator for OpenClaw
Token-budgeted context injection for LLM sessions.

Key features from GPT 5.2 evaluation:
1. Strict token budgeting with predictable truncation
2. Section-based organization (always-on vs situational)
3. Deduplication (don't inject raw + summarized for same item)
4. Must-include facts for critical context
5. Sensitive data filtering

Usage:
    python recall_pack.py --generate                    # Generate pack.md
    python recall_pack.py --context "query"             # Get context for query
    python recall_pack.py --budget 8000 --generate      # Custom token budget
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

# Paths
WORKSPACE = Path(os.environ.get("CLAWD_WORKSPACE", Path.home() / "clawd"))
MEMORY_DIR = WORKSPACE / "memory"
RECALL_DIR = WORKSPACE / "recall"
KNOWLEDGE_DIR = WORKSPACE / "knowledge"
PACK_PATH = RECALL_DIR / "pack.md"
LEDGER_PATH = MEMORY_DIR / "ledger.jsonl"
ENTITY_REGISTRY_PATH = MEMORY_DIR / "entity_registry.json"
FACTS_PATH = KNOWLEDGE_DIR / "facts.json"

# Token estimation (rough: 1 token ≈ 4 chars for English)
CHARS_PER_TOKEN = 4

# Default budgets
DEFAULT_TOTAL_BUDGET = 12000  # ~12k tokens for context

# Section budgets (% of total)
SECTION_BUDGETS = {
    "critical": 0.15,      # P0 constraints, security rules
    "identity": 0.10,      # Who the user is, preferences
    "entities": 0.15,      # Key entities and relationships
    "recent": 0.25,        # Recent events and decisions
    "situational": 0.35    # Query-specific context
}

# Must-include patterns (always include if present)
MUST_INCLUDE_TYPES = {"constraint", "security", "decision"}
MUST_INCLUDE_PRIORITY = {"P0"}


def estimate_tokens(text: str) -> int:
    """Estimate token count for text."""
    return len(text) // CHARS_PER_TOKEN


def truncate_to_budget(text: str, budget_tokens: int) -> str:
    """Truncate text to fit token budget."""
    max_chars = budget_tokens * CHARS_PER_TOKEN
    if len(text) <= max_chars:
        return text
    
    # Truncate at word boundary
    truncated = text[:max_chars]
    last_space = truncated.rfind(' ')
    if last_space > max_chars * 0.8:  # Don't truncate too much
        truncated = truncated[:last_space]
    
    return truncated + "..."


def load_ledger_events() -> List[Dict[str, Any]]:
    """Load events from ledger."""
    events = []
    if not LEDGER_PATH.exists():
        return events
    
    with open(LEDGER_PATH, encoding='utf-8', errors='replace') as f:
        for line in f:
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return events


def load_entity_registry() -> Dict[str, Any]:
    """Load entity registry."""
    if not ENTITY_REGISTRY_PATH.exists():
        return {"entities": {}, "aliases": {}}
    
    with open(ENTITY_REGISTRY_PATH, encoding='utf-8') as f:
        return json.load(f)


def load_facts() -> List[Dict[str, Any]]:
    """Load knowledge facts."""
    if not FACTS_PATH.exists():
        return []
    
    with open(FACTS_PATH, encoding='utf-8') as f:
        return json.load(f)


def filter_sensitive(text: str) -> str:
    """Filter potentially sensitive information."""
    # Mask tokens/API keys
    text = re.sub(r'\b[A-Za-z0-9_-]{32,}\b', '[REDACTED]', text)
    # Mask credit card-like numbers
    text = re.sub(r'\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b', '[CARD]', text)
    # Mask SSN-like numbers
    text = re.sub(r'\b\d{3}-\d{2}-\d{4}\b', '[SSN]', text)
    return text


def deduplicate_content(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Remove duplicate content, preferring summarized over raw."""
    seen_hashes: Set[str] = set()
    deduped = []
    
    # Sort to prefer facts over raw (facts are summarized)
    items_sorted = sorted(items, key=lambda x: 0 if x.get("type") == "fact" else 1)
    
    for item in items_sorted:
        content = item.get("content", item.get("text", ""))
        # Simple hash for deduplication
        content_hash = hash(content.lower()[:100])
        
        if content_hash not in seen_hashes:
            seen_hashes.add(content_hash)
            deduped.append(item)
    
    return deduped


class RecallPack:
    """Token-budgeted recall pack builder."""
    
    def __init__(self, total_budget: int = DEFAULT_TOTAL_BUDGET):
        self.total_budget = total_budget
        self.sections: Dict[str, List[str]] = {
            "critical": [],
            "identity": [],
            "entities": [],
            "recent": [],
            "situational": []
        }
        self.used_tokens: Dict[str, int] = {k: 0 for k in self.sections}
    
    def section_budget(self, section: str) -> int:
        """Get token budget for a section."""
        return int(self.total_budget * SECTION_BUDGETS.get(section, 0.1))
    
    def add_to_section(self, section: str, content: str, force: bool = False) -> bool:
        """
        Add content to a section if budget allows.
        
        Args:
            section: Section name
            content: Content to add
            force: Force add even if over budget (for must-include)
            
        Returns:
            True if added, False if rejected
        """
        tokens = estimate_tokens(content)
        budget = self.section_budget(section)
        
        if not force and self.used_tokens[section] + tokens > budget:
            return False
        
        self.sections[section].append(content)
        self.used_tokens[section] += tokens
        return True
    
    def build_critical_section(self, events: List[Dict]) -> None:
        """Build critical section (P0 constraints, security)."""
        for event in events:
            if event.get("priority") in MUST_INCLUDE_PRIORITY or \
               event.get("type") in MUST_INCLUDE_TYPES:
                content = event.get("content", event.get("text", ""))
                content = filter_sensitive(content)
                if content:
                    self.add_to_section("critical", f"- {content}", force=True)
    
    def build_identity_section(self, events: List[Dict], entities: Dict) -> None:
        """Build identity section (user info, preferences)."""
        # Add user entity
        user_entities = [e for e, data in entities.get("entities", {}).items() 
                        if data.get("type") == "person" and data.get("mention_count", 0) > 5]
        
        for entity in user_entities[:2]:
            self.add_to_section("identity", f"User: {entity}")
        
        # Add preferences
        for event in events:
            if event.get("type") == "preference":
                content = event.get("content", "")
                if content:
                    self.add_to_section("identity", f"- Preference: {content}")
    
    def build_entities_section(self, entities: Dict) -> None:
        """Build entities section."""
        entity_data = entities.get("entities", {})
        aliases = entities.get("aliases", {})
        
        # Top entities by mention count
        sorted_entities = sorted(
            entity_data.items(),
            key=lambda x: x[1].get("mention_count", 0),
            reverse=True
        )[:10]
        
        for entity, data in sorted_entities:
            entity_aliases = [a for a, c in aliases.items() if c == entity][:3]
            line = f"- {entity} ({data.get('type', 'unknown')})"
            if entity_aliases:
                line += f" [aliases: {', '.join(entity_aliases)}]"
            self.add_to_section("entities", line)
    
    def build_recent_section(self, events: List[Dict]) -> None:
        """Build recent events section."""
        now = datetime.now(timezone.utc)
        
        # Get events from last 7 days
        recent = []
        for event in events:
            ts_str = event.get("ts", event.get("timestamp", ""))
            if ts_str:
                try:
                    ts = datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
                    if ts.tzinfo is None:
                        ts = ts.replace(tzinfo=timezone.utc)
                    age_days = (now - ts).total_seconds() / 86400
                    if age_days <= 7:
                        recent.append(event)
                except Exception:
                    continue
        
        # Sort by timestamp (most recent first)
        recent.sort(key=lambda x: x.get("ts", ""), reverse=True)
        
        for event in recent[:20]:
            content = event.get("content", event.get("text", ""))
            content = filter_sensitive(content)[:200]
            if content:
                ts = event.get("ts", "")[:10]
                self.add_to_section("recent", f"- [{ts}] {content}")
    
    def build_situational_section(self, query: str, search_fn=None) -> None:
        """Build situational section based on query."""
        if not query or not search_fn:
            return
        
        results = search_fn(query, top_k=10)
        results = deduplicate_content(results)
        
        for result in results:
            content = result.get("content", result.get("text", ""))
            content = filter_sensitive(content)[:300]
            if content:
                self.add_to_section("situational", f"- {content}")
    
    def generate(self) -> str:
        """Generate the recall pack markdown."""
        lines = [
            "# Recall Pack",
            f"Generated: {datetime.now(timezone.utc).isoformat()}",
            f"Budget: {self.total_budget} tokens",
            "",
        ]
        
        section_titles = {
            "critical": "## Critical (P0 Constraints)",
            "identity": "## Identity & Preferences", 
            "entities": "## Key Entities",
            "recent": "## Recent Events (7 days)",
            "situational": "## Situational Context"
        }
        
        for section, title in section_titles.items():
            if self.sections[section]:
                lines.append(title)
                lines.extend(self.sections[section])
                lines.append(f"<!-- {self.used_tokens[section]} tokens -->")
                lines.append("")
        
        total_used = sum(self.used_tokens.values())
        lines.append(f"<!-- Total: {total_used}/{self.total_budget} tokens -->")
        
        return "\n".join(lines)


def generate_pack(
    total_budget: int = DEFAULT_TOTAL_BUDGET,
    query: str = None
) -> str:
    """Generate a recall pack."""
    pack = RecallPack(total_budget)
    
    # Load data
    events = load_ledger_events()
    entities = load_entity_registry()
    
    # Build sections
    pack.build_critical_section(events)
    pack.build_identity_section(events, entities)
    pack.build_entities_section(entities)
    pack.build_recent_section(events)
    
    # Build situational if query provided
    if query:
        try:
            from unified_search_v2 import unified_search_v2 as search_fn
            pack.build_situational_section(query, search_fn)
        except ImportError:
            try:
                from unified_search import unified_search as search_fn
                pack.build_situational_section(query, search_fn)
            except ImportError:
                pass
    
    return pack.generate()


def get_context_for_query(
    query: str,
    budget: int = 4000
) -> str:
    """
    Get context for a specific query.
    
    This is the main API for context injection.
    """
    pack = RecallPack(budget)
    
    # Load minimal data
    events = load_ledger_events()
    entities = load_entity_registry()
    
    # Always include critical
    pack.build_critical_section(events)
    
    # Focus on situational for query-specific context
    try:
        from unified_search_v2 import unified_search_v2 as search_fn
        pack.build_situational_section(query, search_fn)
    except ImportError:
        try:
            from unified_search import unified_search as search_fn
            pack.build_situational_section(query, search_fn)
        except ImportError:
            pass
    
    # Compact format for injection
    lines = []
    for section, items in pack.sections.items():
        if items:
            lines.extend(items)
    
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Recall pack generator")
    parser.add_argument("--generate", action="store_true", help="Generate pack.md")
    parser.add_argument("--context", type=str, help="Get context for query")
    parser.add_argument("--budget", type=int, default=DEFAULT_TOTAL_BUDGET, help="Token budget")
    parser.add_argument("--output", type=str, help="Output path (default: recall/pack.md)")
    
    args = parser.parse_args()
    
    if args.context:
        context = get_context_for_query(args.context, budget=args.budget)
        print(context)
        return
    
    if args.generate:
        pack = generate_pack(total_budget=args.budget)
        
        output_path = Path(args.output) if args.output else PACK_PATH
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(output_path, "w", encoding='utf-8') as f:
            f.write(pack)
        
        print(f"Generated recall pack: {output_path}")
        print(f"Budget: {args.budget} tokens")
        return
    
    parser.print_help()


if __name__ == "__main__":
    main()
