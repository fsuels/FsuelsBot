#!/usr/bin/env python3
"""
Retrieval Validation for OpenClaw Memory System
Measures search quality against golden test set.

Metrics:
- Entity Recall@k: % of expected entities found in top k results
- Keyword Recall@k: % of expected keywords found in top k results
- Overall Score: Combined metric

Usage:
    python validate_retrieval.py                    # Run all queries
    python validate_retrieval.py --query Q001      # Run single query
    python validate_retrieval.py --summary         # Summary only
"""

import argparse
import json
import sys
from pathlib import Path

# Add parent to path
sys.path.insert(0, str(Path(__file__).parent))

WORKSPACE = Path.home() / "clawd"
GOLDEN_PATH = WORKSPACE / "memory" / "golden_queries.json"


def load_golden_queries() -> list[dict]:
    """Load golden test queries."""
    with open(GOLDEN_PATH) as f:
        data = json.load(f)
    return data.get("queries", [])


def run_search(query: str, mode: str = "auto", top_k: int = 5) -> list[dict]:
    """Run search and return results."""
    from search import search
    response = search(query, mode=mode, top_k=top_k)
    return response.get("results", [])


def calculate_recall(results: list[dict], expected: list[str], field: str = "content") -> float:
    """
    Calculate recall for expected items in results.
    
    Args:
        results: Search results
        expected: List of expected strings (entities or keywords)
        field: Field to search in results
        
    Returns:
        Recall score (0-1)
    """
    if not expected:
        return 1.0
    
    found = 0
    result_text = " ".join([r.get(field, "").lower() for r in results])
    
    for item in expected:
        if item.lower() in result_text:
            found += 1
    
    return found / len(expected)


def validate_query(query_spec: dict, top_k: int = 5, verbose: bool = True) -> dict:
    """
    Validate a single query against expected results.
    
    Returns:
        {
            "query_id": str,
            "query": str,
            "entity_recall": float,
            "keyword_recall": float,
            "overall_score": float,
            "found_entities": list,
            "found_keywords": list,
            "missing_entities": list,
            "missing_keywords": list
        }
    """
    query_id = query_spec["id"]
    query = query_spec["query"]
    mode = query_spec.get("mode", "auto")
    expected_entities = query_spec.get("expected_entities", [])
    expected_keywords = query_spec.get("expected_keywords", [])
    
    # Run search
    results = run_search(query, mode=mode, top_k=top_k)
    result_text = " ".join([r.get("content", "").lower() for r in results])
    
    # Calculate entity recall
    found_entities = []
    missing_entities = []
    for entity in expected_entities:
        if entity.lower() in result_text:
            found_entities.append(entity)
        else:
            missing_entities.append(entity)
    
    entity_recall = len(found_entities) / len(expected_entities) if expected_entities else 1.0
    
    # Calculate keyword recall
    found_keywords = []
    missing_keywords = []
    for keyword in expected_keywords:
        if keyword.lower() in result_text:
            found_keywords.append(keyword)
        else:
            missing_keywords.append(keyword)
    
    keyword_recall = len(found_keywords) / len(expected_keywords) if expected_keywords else 1.0
    
    # Overall score (weighted average)
    overall_score = (entity_recall * 0.6) + (keyword_recall * 0.4)
    
    result = {
        "query_id": query_id,
        "query": query,
        "mode": mode,
        "entity_recall": round(entity_recall, 3),
        "keyword_recall": round(keyword_recall, 3),
        "overall_score": round(overall_score, 3),
        "found_entities": found_entities,
        "found_keywords": found_keywords,
        "missing_entities": missing_entities,
        "missing_keywords": missing_keywords,
        "result_count": len(results)
    }
    
    if verbose:
        status = "✓" if overall_score >= 0.7 else "⚠" if overall_score >= 0.5 else "✗"
        print(f"{status} {query_id}: {overall_score:.0%} (entities: {entity_recall:.0%}, keywords: {keyword_recall:.0%})")
        if missing_entities:
            print(f"    Missing entities: {missing_entities}")
        if missing_keywords:
            print(f"    Missing keywords: {missing_keywords}")
    
    return result


def validate_all(top_k: int = 5, verbose: bool = True) -> dict:
    """
    Run validation on all golden queries.
    
    Returns:
        {
            "total_queries": int,
            "avg_entity_recall": float,
            "avg_keyword_recall": float,
            "avg_overall_score": float,
            "passing": int (score >= 0.7),
            "warning": int (0.5 <= score < 0.7),
            "failing": int (score < 0.5),
            "results": list[dict]
        }
    """
    queries = load_golden_queries()
    
    if verbose:
        print(f"Running {len(queries)} golden queries (top_k={top_k})...\n")
    
    results = []
    total_entity = 0
    total_keyword = 0
    total_overall = 0
    passing = 0
    warning = 0
    failing = 0
    
    for query_spec in queries:
        result = validate_query(query_spec, top_k=top_k, verbose=verbose)
        results.append(result)
        
        total_entity += result["entity_recall"]
        total_keyword += result["keyword_recall"]
        total_overall += result["overall_score"]
        
        if result["overall_score"] >= 0.7:
            passing += 1
        elif result["overall_score"] >= 0.5:
            warning += 1
        else:
            failing += 1
    
    n = len(queries)
    summary = {
        "total_queries": n,
        "avg_entity_recall": round(total_entity / n, 3) if n else 0,
        "avg_keyword_recall": round(total_keyword / n, 3) if n else 0,
        "avg_overall_score": round(total_overall / n, 3) if n else 0,
        "passing": passing,
        "warning": warning,
        "failing": failing,
        "results": results
    }
    
    if verbose:
        print(f"\n{'='*50}")
        print(f"SUMMARY")
        print(f"{'='*50}")
        print(f"Total queries: {n}")
        print(f"Average entity recall: {summary['avg_entity_recall']:.1%}")
        print(f"Average keyword recall: {summary['avg_keyword_recall']:.1%}")
        print(f"Average overall score: {summary['avg_overall_score']:.1%}")
        print(f"\nPassing (≥70%): {passing}")
        print(f"Warning (50-69%): {warning}")
        print(f"Failing (<50%): {failing}")
        
        grade = "A" if summary['avg_overall_score'] >= 0.9 else \
                "B" if summary['avg_overall_score'] >= 0.8 else \
                "C" if summary['avg_overall_score'] >= 0.7 else \
                "D" if summary['avg_overall_score'] >= 0.6 else "F"
        print(f"\nGrade: {grade}")
    
    return summary


def main():
    parser = argparse.ArgumentParser(description="Validate retrieval quality")
    parser.add_argument("--query", help="Run single query by ID (e.g., Q001)")
    parser.add_argument("--top-k", type=int, default=5, help="Number of results to check")
    parser.add_argument("--summary", action="store_true", help="Summary only (no per-query details)")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    
    args = parser.parse_args()
    
    # Suppress warnings
    import warnings
    warnings.filterwarnings("ignore")
    
    if args.query:
        queries = load_golden_queries()
        query_spec = next((q for q in queries if q["id"] == args.query), None)
        if not query_spec:
            print(f"Query {args.query} not found", file=sys.stderr)
            sys.exit(1)
        
        result = validate_query(query_spec, top_k=args.top_k, verbose=not args.json)
        if args.json:
            print(json.dumps(result, indent=2))
    
    else:
        summary = validate_all(top_k=args.top_k, verbose=not args.json and not args.summary)
        
        if args.json:
            print(json.dumps(summary, indent=2))
        elif args.summary:
            print(f"Score: {summary['avg_overall_score']:.1%} | Pass: {summary['passing']}/{summary['total_queries']} | Entity: {summary['avg_entity_recall']:.1%} | Keyword: {summary['avg_keyword_recall']:.1%}")


if __name__ == "__main__":
    main()
