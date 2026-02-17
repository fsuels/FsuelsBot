#!/usr/bin/env python3
"""
Evaluation Harness for OpenClaw Memory System
Recall@k + MRR scoring for golden queries.

Key features from GPT 5.2 evaluation:
1. Recall@k (k=1,5,10) - what % of expected items are found in top-k
2. MRR (Mean Reciprocal Rank) - average of 1/rank for first correct result
3. Per-tag breakdown - performance by query category
4. Structured expectations - entity_id + predicate instead of prose

Usage:
    python eval_harness.py                        # Run full evaluation
    python eval_harness.py --query Q001           # Test single query
    python eval_harness.py --json                 # Output as JSON
    python eval_harness.py --mode unified         # Test specific mode
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent))

# Paths
WORKSPACE = Path(os.environ.get("CLAWD_WORKSPACE", Path.home() / "clawd"))
MEMORY_DIR = WORKSPACE / "memory"
GOLDEN_QUERIES_PATH = MEMORY_DIR / "golden_queries.json"

# K values for Recall@k
K_VALUES = [1, 5, 10]


def load_golden_queries() -> List[Dict[str, Any]]:
    """Load golden queries from JSON."""
    if not GOLDEN_QUERIES_PATH.exists():
        return []
    
    with open(GOLDEN_QUERIES_PATH, encoding='utf-8') as f:
        data = json.load(f)
    
    return data.get("queries", [])


def normalize_text(text: str) -> str:
    """Normalize text for comparison."""
    return re.sub(r'[^a-z0-9]', '', text.lower())


def check_entity_match(result: Dict, expected_entities: List[str]) -> bool:
    """Check if result contains any expected entity."""
    content = result.get("content", "") + " " + result.get("text", "")
    content += " " + " ".join(result.get("entities", []))
    content_norm = normalize_text(content)
    
    for entity in expected_entities:
        if normalize_text(entity) in content_norm:
            return True
    return False


def check_keyword_match(result: Dict, expected_keywords: List[str]) -> bool:
    """Check if result contains any expected keyword."""
    content = result.get("content", "") + " " + result.get("text", "")
    content_norm = normalize_text(content)
    
    for keyword in expected_keywords:
        if normalize_text(keyword) in content_norm:
            return True
    return False


def is_relevant(result: Dict, golden: Dict) -> bool:
    """
    Check if a result is relevant to a golden query.
    
    A result is relevant if it contains:
    - Any expected entity AND any expected keyword
    - OR at least 2 expected entities
    - OR at least 2 expected keywords
    """
    expected_entities = golden.get("expected_entities", [])
    expected_keywords = golden.get("expected_keywords", [])
    
    entity_matches = sum(
        1 for e in expected_entities 
        if normalize_text(e) in normalize_text(
            result.get("content", "") + " " + " ".join(result.get("entities", []))
        )
    )
    
    keyword_matches = sum(
        1 for k in expected_keywords
        if normalize_text(k) in normalize_text(result.get("content", ""))
    )
    
    # Relevance criteria
    if entity_matches >= 1 and keyword_matches >= 1:
        return True
    if entity_matches >= 2:
        return True
    if keyword_matches >= 2:
        return True
    
    return False


def calculate_recall_at_k(results: List[Dict], golden: Dict, k: int) -> float:
    """
    Calculate Recall@k for a query.
    
    Recall@k = (# relevant results in top-k) / (total expected relevant items)
    """
    expected_entities = golden.get("expected_entities", [])
    expected_keywords = golden.get("expected_keywords", [])
    total_expected = len(expected_entities) + len(expected_keywords)
    
    if total_expected == 0:
        return 1.0  # No expectations, consider it a success
    
    # Count how many expected items are found in top-k
    found_entities = set()
    found_keywords = set()
    
    for result in results[:k]:
        content = result.get("content", "") + " " + result.get("text", "")
        content += " " + " ".join(result.get("entities", []))
        content_norm = normalize_text(content)
        
        for entity in expected_entities:
            if normalize_text(entity) in content_norm:
                found_entities.add(entity)
        
        for keyword in expected_keywords:
            if normalize_text(keyword) in content_norm:
                found_keywords.add(keyword)
    
    total_found = len(found_entities) + len(found_keywords)
    return total_found / total_expected


def calculate_mrr(results: List[Dict], golden: Dict) -> float:
    """
    Calculate Mean Reciprocal Rank for a query.
    
    MRR = 1 / rank of first relevant result (or 0 if none found)
    """
    for rank, result in enumerate(results, start=1):
        if is_relevant(result, golden):
            return 1.0 / rank
    return 0.0


def run_search(query: str, mode: str = "auto") -> List[Dict]:
    """Run search with specified mode."""
    try:
        # Try v2 first
        from unified_search_v2 import unified_search_v2
        return unified_search_v2(query, top_k=20)
    except ImportError:
        pass
    
    try:
        from search import search
        from search import SearchRequest
        req = SearchRequest(query=query, top_k=20)
        return search(req)
    except ImportError:
        pass
    
    try:
        from unified_search import unified_search
        return unified_search(query, top_k=20)
    except ImportError:
        pass
    
    return []


def evaluate_query(
    golden: Dict,
    mode: str = "auto",
    verbose: bool = False
) -> Dict[str, Any]:
    """
    Evaluate a single golden query.
    
    Returns metrics dict with recall@k and MRR.
    """
    query = golden.get("query", "")
    query_id = golden.get("id", "?")
    
    # Run search
    results = run_search(query, mode)
    
    # Calculate metrics
    metrics = {
        "query_id": query_id,
        "query": query,
        "mode": mode,
        "num_results": len(results),
        "mrr": calculate_mrr(results, golden),
    }
    
    for k in K_VALUES:
        metrics[f"recall@{k}"] = calculate_recall_at_k(results, golden, k)
    
    # Add tags for breakdown
    metrics["tags"] = golden.get("tags", []) or [golden.get("mode", "unknown")]
    
    if verbose:
        metrics["results_preview"] = [
            r.get("content", "")[:80] for r in results[:5]
        ]
    
    return metrics


def evaluate_all(
    mode: str = "auto",
    verbose: bool = False,
    query_filter: Optional[str] = None
) -> Dict[str, Any]:
    """
    Evaluate all golden queries.
    
    Returns aggregate metrics and per-query breakdown.
    """
    golden_queries = load_golden_queries()
    
    if query_filter:
        golden_queries = [g for g in golden_queries if g.get("id") == query_filter]
    
    if not golden_queries:
        return {"error": "No golden queries found"}
    
    results = []
    for golden in golden_queries:
        result = evaluate_query(golden, mode=mode, verbose=verbose)
        results.append(result)
    
    # Aggregate metrics
    n = len(results)
    aggregate = {
        "total_queries": n,
        "mode": mode,
        "timestamp": datetime.now().isoformat(),
        "mrr": sum(r["mrr"] for r in results) / n,
    }
    
    for k in K_VALUES:
        key = f"recall@{k}"
        aggregate[key] = sum(r[key] for r in results) / n
    
    # Per-tag breakdown
    tag_metrics: Dict[str, Dict[str, List[float]]] = {}
    for result in results:
        for tag in result["tags"]:
            if tag not in tag_metrics:
                tag_metrics[tag] = {"mrr": [], **{f"recall@{k}": [] for k in K_VALUES}}
            tag_metrics[tag]["mrr"].append(result["mrr"])
            for k in K_VALUES:
                tag_metrics[tag][f"recall@{k}"].append(result[f"recall@{k}"])
    
    per_tag = {}
    for tag, metrics in tag_metrics.items():
        per_tag[tag] = {
            "count": len(metrics["mrr"]),
            "mrr": sum(metrics["mrr"]) / len(metrics["mrr"]),
            **{
                f"recall@{k}": sum(metrics[f"recall@{k}"]) / len(metrics[f"recall@{k}"])
                for k in K_VALUES
            }
        }
    
    return {
        "aggregate": aggregate,
        "per_tag": per_tag,
        "queries": results
    }


def format_results(evaluation: Dict, as_json: bool = False) -> str:
    """Format evaluation results for display."""
    if as_json:
        return json.dumps(evaluation, indent=2)
    
    if "error" in evaluation:
        return f"Error: {evaluation['error']}"
    
    lines = []
    agg = evaluation["aggregate"]
    
    lines.append("=" * 60)
    lines.append("MEMORY SYSTEM EVALUATION")
    lines.append("=" * 60)
    lines.append(f"Timestamp: {agg['timestamp']}")
    lines.append(f"Mode: {agg['mode']}")
    lines.append(f"Total queries: {agg['total_queries']}")
    lines.append("")
    
    # Aggregate metrics
    lines.append("AGGREGATE METRICS")
    lines.append("-" * 40)
    lines.append(f"MRR:        {agg['mrr']:.3f}")
    for k in K_VALUES:
        lines.append(f"Recall@{k}:  {agg[f'recall@{k}']:.3f}")
    
    # Score interpretation
    recall_10 = agg.get('recall@10', 0)
    if recall_10 >= 0.85:
        grade = "EXCELLENT ✓"
    elif recall_10 >= 0.70:
        grade = "GOOD"
    elif recall_10 >= 0.50:
        grade = "NEEDS IMPROVEMENT"
    else:
        grade = "POOR ✗"
    lines.append(f"\nOverall Grade: {grade} (target: 85%+)")
    lines.append("")
    
    # Per-tag breakdown
    lines.append("PER-TAG BREAKDOWN")
    lines.append("-" * 40)
    for tag, metrics in sorted(evaluation.get("per_tag", {}).items()):
        lines.append(f"{tag}: MRR={metrics['mrr']:.2f} R@10={metrics['recall@10']:.2f} (n={metrics['count']})")
    lines.append("")
    
    # Query details
    lines.append("QUERY DETAILS")
    lines.append("-" * 40)
    for q in evaluation.get("queries", []):
        status = "✓" if q["mrr"] > 0 else "✗"
        lines.append(f"{status} [{q['query_id']}] R@10={q['recall@10']:.2f} MRR={q['mrr']:.2f}")
        lines.append(f"   Q: {q['query'][:50]}")
    
    lines.append("")
    lines.append("=" * 60)
    
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Memory system evaluation harness")
    parser.add_argument("--query", type=str, help="Test single query ID (e.g., Q001)")
    parser.add_argument("--mode", type=str, default="auto",
                       choices=["auto", "unified", "hybrid", "semantic"],
                       help="Search mode to test")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    parser.add_argument("--verbose", action="store_true", help="Show result previews")
    
    args = parser.parse_args()
    
    evaluation = evaluate_all(
        mode=args.mode,
        verbose=args.verbose,
        query_filter=args.query
    )
    
    print(format_results(evaluation, as_json=args.json))


if __name__ == "__main__":
    main()
