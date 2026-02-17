#!/usr/bin/env python3
"""
Memory Consolidation for OpenClaw
Weekly summarization of daily logs into themes.

Based on TraceMem research: topic segmentation → clustering → compression

Usage:
    python consolidate.py --weekly    # Consolidate past 7 days
    python consolidate.py --monthly   # Consolidate past 30 days
    python consolidate.py --dry-run   # Show what would be consolidated

Outputs to memory/consolidated/
"""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

# Paths
WORKSPACE = Path(os.environ.get("CLAWD_WORKSPACE", Path.home() / "clawd"))
MEMORY_DIR = WORKSPACE / "memory"
CONSOLIDATED_DIR = MEMORY_DIR / "consolidated"

# Ensure directories exist
CONSOLIDATED_DIR.mkdir(parents=True, exist_ok=True)

CONSOLIDATION_PROMPT = """You are a memory consolidation system. Summarize these daily logs into key themes and facts.

Rules:
1. Extract the most important facts, decisions, and milestones
2. Group related items into themes
3. Preserve specific details (dates, numbers, names)
4. Use bullet points for clarity
5. Separate into: FACTS, DECISIONS, OPEN ITEMS, INSIGHTS
6. Maximum 500 words total

---
DAILY LOGS ({start_date} to {end_date}):

{content}

---

CONSOLIDATED SUMMARY:"""


def call_llm(prompt: str) -> str:
    """Call LLM for consolidation."""
    try:
        import anthropic
        client = anthropic.Anthropic()
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}]
        )
        return response.content[0].text
    except ImportError:
        print("Error: anthropic package not installed", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error calling LLM: {e}", file=sys.stderr)
        sys.exit(1)


def get_daily_logs(days: int) -> list[tuple[str, str]]:
    """Get daily log files from past N days."""
    logs = []
    today = datetime.now().date()
    
    for i in range(days):
        date = today - timedelta(days=i)
        date_str = date.strftime("%Y-%m-%d")
        log_file = MEMORY_DIR / f"{date_str}.md"
        
        if log_file.exists():
            content = log_file.read_text(encoding='utf-8', errors='replace')
            if content.strip():
                logs.append((date_str, content))
    
    return logs


def consolidate(logs: list[tuple[str, str]], period: str) -> str:
    """Consolidate logs into summary."""
    if not logs:
        return "No logs to consolidate."
    
    # Sort by date
    logs.sort(key=lambda x: x[0])
    
    start_date = logs[0][0]
    end_date = logs[-1][0]
    
    # Combine content (truncate if too long)
    combined = []
    total_chars = 0
    max_chars = 30000  # Keep under context limit
    
    for date_str, content in logs:
        if total_chars + len(content) > max_chars:
            # Truncate
            remaining = max_chars - total_chars
            content = content[:remaining] + "\n... [truncated]"
        
        combined.append(f"## {date_str}\n{content}")
        total_chars += len(content)
        
        if total_chars >= max_chars:
            break
    
    prompt = CONSOLIDATION_PROMPT.format(
        start_date=start_date,
        end_date=end_date,
        content="\n\n".join(combined)
    )
    
    return call_llm(prompt)


def save_consolidation(summary: str, start_date: str, end_date: str, period: str):
    """Save consolidation to file."""
    filename = f"{period}_{start_date}_to_{end_date}.md"
    filepath = CONSOLIDATED_DIR / filename
    
    header = f"""# {period.title()} Consolidation
**Period:** {start_date} to {end_date}
**Generated:** {datetime.now().isoformat()}

---

"""
    
    with open(filepath, "w") as f:
        f.write(header + summary)
    
    print(f"Saved consolidation to {filepath}", file=sys.stderr)
    return filepath


def main():
    parser = argparse.ArgumentParser(description="Memory consolidation")
    parser.add_argument("--weekly", action="store_true", help="Consolidate past 7 days")
    parser.add_argument("--monthly", action="store_true", help="Consolidate past 30 days")
    parser.add_argument("--days", type=int, help="Custom number of days")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be consolidated")
    
    args = parser.parse_args()
    
    if args.weekly:
        days = 7
        period = "weekly"
    elif args.monthly:
        days = 30
        period = "monthly"
    elif args.days:
        days = args.days
        period = f"{days}day"
    else:
        parser.print_help()
        sys.exit(1)
    
    logs = get_daily_logs(days)
    
    if not logs:
        print(f"No daily logs found for past {days} days", file=sys.stderr)
        sys.exit(0)
    
    print(f"Found {len(logs)} daily logs to consolidate", file=sys.stderr)
    
    if args.dry_run:
        print("\nWould consolidate these logs:")
        for date_str, content in logs:
            print(f"  - {date_str}: {len(content)} chars")
        sys.exit(0)
    
    # Consolidate
    summary = consolidate(logs, period)
    
    # Save
    start_date = logs[0][0]
    end_date = logs[-1][0]
    filepath = save_consolidation(summary, start_date, end_date, period)
    
    # Output summary
    print(summary)


if __name__ == "__main__":
    main()
