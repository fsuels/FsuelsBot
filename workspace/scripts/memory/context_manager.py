#!/usr/bin/env python3
"""
Agent-Managed Context Loading for OpenClaw
Based on Letta/MemGPT - agent decides what to load into context.

Instead of static bootstrap loading same files every session,
dynamically select context based on current task.

Usage:
    python context_manager.py --task "DLM SEO work"    # Get relevant context
    python context_manager.py --task "123LegalDoc"    # Different context
    python context_manager.py --current               # Show current context budget
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

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent))

# Context budget (tokens approximation)
MAX_CONTEXT_TOKENS = 8000  # How much to inject
TOKENS_PER_CHAR = 0.25  # Rough estimate

# Task-to-context mapping
CONTEXT_PROFILES = {
    "dlm": {
        "description": "Dress Like Mommy e-commerce work",
        "files": [
            "memory/dlm-*.md",
            "knowledge/dlm.md",
        ],
        "entities": ["DLM", "Shopify", "BuckyDrop", "GMC", "Google Ads"],
        "keywords": ["ecommerce", "shopify", "mommy", "dropship", "seo", "ads"]
    },
    "123legaldoc": {
        "description": "123LegalDoc development",
        "files": [
            "memory/tasks/T-003*.md",
        ],
        "entities": ["123LegalDoc"],
        "keywords": ["legal", "document", "wizard", "sections", "questions"]
    },
    "memory": {
        "description": "Memory system work",
        "files": [
            "scripts/memory/README.md",
            "memory/global/ai-memory-research.md",
        ],
        "entities": ["FsuelsBot", "memory", "extraction"],
        "keywords": ["memory", "extraction", "embedding", "graph", "semantic"]
    },
    "general": {
        "description": "General context",
        "files": [
            "MEMORY.md",
            "SOUL.md",
        ],
        "entities": ["Francisco", "FsuelsBot"],
        "keywords": []
    }
}


def estimate_tokens(text: str) -> int:
    """Estimate token count."""
    return int(len(text) * TOKENS_PER_CHAR)


def match_profile(task: str) -> str:
    """Match task to context profile."""
    task_lower = task.lower()
    
    for profile_name, profile in CONTEXT_PROFILES.items():
        if profile_name == "general":
            continue
        
        # Check keywords
        for keyword in profile["keywords"]:
            if keyword in task_lower:
                return profile_name
        
        # Check entities
        for entity in profile["entities"]:
            if entity.lower() in task_lower:
                return profile_name
    
    return "general"


def dynamic_context_selection(task: str, max_tokens: int = 8000) -> dict:
    """
    Dynamic context selection based on StateLM approach.
    Instead of static profiles, analyze task and query memory dynamically.
    
    Args:
        task: Current task description
        max_tokens: Token budget
        
    Returns:
        Context pack with dynamically selected content
    """
    from hybrid_search import hybrid_search, extract_query_entities
    
    # Extract entities from task
    entities = extract_query_entities(task)
    
    # Search for relevant memories
    memories = hybrid_search(task, top_k=30, min_score=0.2)
    
    # Build context with most relevant memories under budget
    context = {
        "task": task,
        "profile": "dynamic",
        "description": f"Dynamic selection for: {task[:50]}",
        "entities_detected": entities,
        "memories": [],
        "total_tokens": 0
    }
    
    tokens_used = 0
    for mem in memories:
        content = mem.get("content", "")
        tokens = estimate_tokens(content)
        
        if tokens_used + tokens > max_tokens:
            break
        
        context["memories"].append({
            "content": content[:300],
            "score": mem.get("hybrid_score", mem.get("composite_score", 0)),
            "priority": mem.get("priority", "P2"),
            "tokens": tokens
        })
        tokens_used += tokens
    
    context["total_tokens"] = tokens_used
    
    return context


def get_relevant_memories(task: str, profile: dict, max_tokens: int) -> list[dict]:
    """Get relevant memories for task within token budget."""
    from semantic_search import search, load_index
    
    # Load embedding index
    index, _ = load_index()
    if not index:
        return []
    
    # Search for relevant memories
    results = search(task, top_k=20)
    
    # Filter to budget
    selected = []
    used_tokens = 0
    
    for result in results:
        content = result.get("content", "")
        tokens = estimate_tokens(content)
        
        if used_tokens + tokens > max_tokens:
            break
        
        selected.append(result)
        used_tokens += tokens
    
    return selected


def get_relevant_files(profile: dict) -> list[tuple[str, str]]:
    """Get relevant files for profile. Returns [(path, content), ...]"""
    files = []
    
    for pattern in profile.get("files", []):
        # Expand globs
        if "*" in pattern:
            for f in WORKSPACE.glob(pattern):
                if f.is_file():
                    try:
                        content = f.read_text(encoding='utf-8', errors='replace')[:3000]
                        files.append((str(f.relative_to(WORKSPACE)), content))
                    except Exception:
                        pass
        else:
            f = WORKSPACE / pattern
            if f.is_file():
                try:
                    content = f.read_text(encoding='utf-8', errors='replace')[:3000]
                    files.append((str(f.relative_to(WORKSPACE)), content))
                except Exception:
                    pass
    
    return files


def build_context_pack(task: str, max_tokens: int = MAX_CONTEXT_TOKENS) -> dict:
    """Build context pack for task."""
    profile_name = match_profile(task)
    profile = CONTEXT_PROFILES[profile_name]
    
    context = {
        "task": task,
        "profile": profile_name,
        "description": profile["description"],
        "files": [],
        "memories": [],
        "total_tokens": 0
    }
    
    # Get relevant files
    files = get_relevant_files(profile)
    tokens_used = 0
    
    for path, content in files:
        tokens = estimate_tokens(content)
        if tokens_used + tokens > max_tokens * 0.5:  # Reserve half for memories
            break
        context["files"].append({"path": path, "tokens": tokens})
        tokens_used += tokens
    
    # Get relevant memories
    remaining = max_tokens - tokens_used
    memories = get_relevant_memories(task, profile, remaining)
    
    for mem in memories:
        tokens = estimate_tokens(mem.get("content", ""))
        context["memories"].append({
            "content": mem.get("content", "")[:200],
            "score": mem.get("score", 0),
            "tokens": tokens
        })
        tokens_used += tokens
    
    context["total_tokens"] = tokens_used
    
    return context


def main():
    parser = argparse.ArgumentParser(description="Context manager")
    parser.add_argument("--task", help="Get context for task")
    parser.add_argument("--current", action="store_true", help="Show current context budget")
    parser.add_argument("--profiles", action="store_true", help="List available profiles")
    parser.add_argument("--max-tokens", type=int, default=MAX_CONTEXT_TOKENS, help="Max tokens")
    parser.add_argument("--dynamic", action="store_true", help="Use dynamic context selection (StateLM approach)")
    
    args = parser.parse_args()
    
    if args.profiles:
        print("Available context profiles:")
        for name, profile in CONTEXT_PROFILES.items():
            print(f"\n  {name}:")
            print(f"    {profile['description']}")
            print(f"    Keywords: {', '.join(profile['keywords'][:5])}")
        return
    
    if args.task:
        if args.dynamic:
            context = dynamic_context_selection(args.task, args.max_tokens)
        else:
            context = build_context_pack(args.task, args.max_tokens)
        print(json.dumps(context, indent=2))
    
    elif args.current:
        print(f"Max context tokens: {MAX_CONTEXT_TOKENS}")
        print(f"Available profiles: {', '.join(CONTEXT_PROFILES.keys())}")
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
