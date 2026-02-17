#!/usr/bin/env python3
"""
Chain-of-Verification (CoVe) Implementation for OpenClaw Memory System
Based on Meta AI paper (arXiv:2309.11495) - reduces hallucinations by 50%+

The CoVe pattern:
1. DRAFT: Generate initial response/extraction
2. PLAN: Generate verification questions to fact-check the draft
3. EXECUTE: Answer verification questions independently (no access to draft)
4. VERIFY: Compare answers to draft, fix inconsistencies

Usage:
    # Verify extracted facts before storing
    python chain_of_verification.py --verify-facts facts.jsonl
    
    # Verify a single claim
    python chain_of_verification.py --claim "Francisco completed task T-010 yesterday"
    
    # Verify task completion
    python chain_of_verification.py --task-complete T-007 "All QA tests passed"

Integration:
    Called by extract_facts.py after extraction, before ledger append.
    Called by task completion flow before marking DONE.
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional
import subprocess

# Paths
WORKSPACE = Path(os.environ.get("CLAWD_WORKSPACE", Path.home() / "clawd"))
MEMORY_DIR = WORKSPACE / "memory"
LEDGER_PATH = MEMORY_DIR / "ledger.jsonl"
COVE_LOG_PATH = MEMORY_DIR / "cove_verification.jsonl"

# Add parent for imports
sys.path.insert(0, str(Path(__file__).parent))


# ============================================================================
# LLM INTEGRATION
# ============================================================================

def call_llm(prompt: str, temperature: float = 0.0) -> str:
    """Call LLM for CoVe steps. Low temperature for consistency."""
    try:
        # Try OpenClaw delegate first
        result = subprocess.run(
            ["openclaw", "delegate", "--task", prompt],
            capture_output=True,
            text=True,
            timeout=90
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    
    # Fallback to Anthropic API
    try:
        import anthropic
        client = anthropic.Anthropic()
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2048,
            temperature=temperature,
            messages=[{"role": "user", "content": prompt}]
        )
        return response.content[0].text
    except Exception as e:
        print(f"Error calling LLM: {e}", file=sys.stderr)
        raise


# ============================================================================
# COVE STEP 2: PLAN VERIFICATION QUESTIONS
# ============================================================================

PLAN_VERIFICATION_PROMPT = """You are a fact-checking system. Given a claim, generate 2-4 specific verification questions.

Each question should:
1. Target a specific, verifiable aspect of the claim
2. Be answerable independently (without seeing the original claim)
3. Focus on: WHO, WHAT, WHEN, WHERE specifics
4. Catch potential hallucinations (wrong names, dates, relationships)

Claim to verify:
"{claim}"

Output JSON array of verification questions:
[
  {{"aspect": "who", "question": "..."}},
  {{"aspect": "when", "question": "..."}}
]

Only output the JSON array:"""


def plan_verification_questions(claim: str) -> list[dict]:
    """Step 2: Generate verification questions for a claim."""
    prompt = PLAN_VERIFICATION_PROMPT.format(claim=claim)
    response = call_llm(prompt)
    
    try:
        # Parse JSON from response
        if "```json" in response:
            response = response.split("```json")[1].split("```")[0]
        elif "```" in response:
            response = response.split("```")[1].split("```")[0]
        
        questions = json.loads(response.strip())
        return questions if isinstance(questions, list) else []
    except json.JSONDecodeError:
        # Fallback: extract questions manually
        return [{"aspect": "general", "question": f"Is the following true: {claim}?"}]


# ============================================================================
# COVE STEP 3: ANSWER VERIFICATION QUESTIONS INDEPENDENTLY
# ============================================================================

ANSWER_VERIFICATION_PROMPT = """You are answering a verification question. Answer based on your knowledge and reasoning.

CRITICAL: Do NOT invent specific details. If you don't know, say "UNKNOWN".

Question: {question}

Context (use if relevant):
{context}

Answer concisely (1-2 sentences). If uncertain, state "UNKNOWN" or "UNCERTAIN":"""


def answer_verification_question(question: str, context: str = "") -> dict:
    """Step 3: Answer a verification question independently."""
    prompt = ANSWER_VERIFICATION_PROMPT.format(question=question, context=context)
    answer = call_llm(prompt, temperature=0.0)
    
    # Check if answer indicates uncertainty
    uncertain = any(word in answer.upper() for word in ["UNKNOWN", "UNCERTAIN", "NOT SURE", "CANNOT VERIFY"])
    
    return {
        "question": question,
        "answer": answer.strip(),
        "uncertain": uncertain
    }


def load_context_for_verification() -> str:
    """Load relevant context from ledger for verification."""
    context_lines = []
    
    if LEDGER_PATH.exists():
        with open(LEDGER_PATH, encoding='utf-8', errors='replace') as f:
            # Get recent high-priority facts
            lines = f.readlines()[-100:]  # Last 100 entries
            for line in lines:
                try:
                    entry = json.loads(line)
                    if entry.get("priority") in ("P0", "P1"):
                        context_lines.append(entry.get("content", ""))
                except json.JSONDecodeError:
                    continue
    
    return "\n".join(context_lines[-30:])  # Limit context size


# ============================================================================
# COVE STEP 4: VERIFY AND RECONCILE
# ============================================================================

RECONCILE_PROMPT = """You are a fact verification system. Compare the original claim against verification answers.

Original claim:
"{claim}"

Verification results:
{verification_results}

Determine:
1. VERIFIED: Claim is supported by verification answers
2. CONTRADICTED: Verification answers contradict the claim
3. UNVERIFIED: Not enough evidence (too many UNKNOWN answers)
4. CORRECTED: Claim needs modification (provide corrected version)

Output JSON:
{{{{
  "verdict": "VERIFIED|CONTRADICTED|UNVERIFIED|CORRECTED",
  "confidence": 0.0-1.0,
  "issues": ["list of specific issues found"],
  "corrected_claim": "only if verdict=CORRECTED",
  "reasoning": "brief explanation"
}}}}

Only output JSON:"""


def verify_and_reconcile(claim: str, qa_pairs: list[dict]) -> dict:
    """Step 4: Compare verification answers to original claim."""
    verification_results = "\n".join([
        f"Q: {qa['question']}\nA: {qa['answer']}"
        for qa in qa_pairs
    ])
    
    prompt = RECONCILE_PROMPT.format(
        claim=claim,
        verification_results=verification_results
    )
    
    response = call_llm(prompt, temperature=0.0)
    
    try:
        if "```json" in response:
            response = response.split("```json")[1].split("```")[0]
        elif "```" in response:
            response = response.split("```")[1].split("```")[0]
        
        result = json.loads(response.strip())
        result["qa_pairs"] = qa_pairs
        return result
    except json.JSONDecodeError:
        return {
            "verdict": "UNVERIFIED",
            "confidence": 0.3,
            "issues": ["Could not parse verification response"],
            "reasoning": response[:200],
            "qa_pairs": qa_pairs
        }


# ============================================================================
# MAIN COVE PIPELINE
# ============================================================================

def verify_claim(claim: str, context: str = None) -> dict:
    """
    Full Chain-of-Verification pipeline for a single claim.
    
    Returns:
        dict with verdict, confidence, issues, and optionally corrected_claim
    """
    if context is None:
        context = load_context_for_verification()
    
    # Step 2: Plan verification questions
    questions = plan_verification_questions(claim)
    
    if not questions:
        return {
            "claim": claim,
            "verdict": "UNVERIFIED",
            "confidence": 0.5,
            "issues": ["Could not generate verification questions"],
            "reasoning": "Verification planning failed"
        }
    
    # Step 3: Answer questions independently
    qa_pairs = []
    for q in questions:
        qa = answer_verification_question(q["question"], context)
        qa["aspect"] = q.get("aspect", "general")
        qa_pairs.append(qa)
    
    # Step 4: Reconcile and verify
    result = verify_and_reconcile(claim, qa_pairs)
    result["claim"] = claim
    result["questions_asked"] = len(questions)
    
    return result


def verify_facts_batch(facts: list[dict], min_confidence: float = 0.7) -> list[dict]:
    """
    Verify a batch of extracted facts using CoVe.
    
    Returns list of facts with verification results attached.
    """
    context = load_context_for_verification()
    verified_facts = []
    
    for fact in facts:
        content = fact.get("content", "")
        if not content:
            continue
        
        # Run CoVe
        verification = verify_claim(content, context)
        
        # Attach result
        fact["cove_verification"] = {
            "verdict": verification.get("verdict"),
            "confidence": verification.get("confidence", 0),
            "issues": verification.get("issues", [])
        }
        
        # Apply corrections if needed
        if verification.get("verdict") == "CORRECTED":
            corrected = verification.get("corrected_claim")
            if corrected:
                fact["original_content"] = content
                fact["content"] = corrected
                fact["tags"] = fact.get("tags", []) + ["cove-corrected"]
        
        # Filter by confidence
        if verification.get("confidence", 0) >= min_confidence:
            fact["tags"] = fact.get("tags", []) + ["cove-verified"]
            verified_facts.append(fact)
        else:
            # Log rejected fact
            log_verification(fact, verification, accepted=False)
    
    return verified_facts


def verify_task_completion(task_id: str, completion_claim: str, evidence: list[str] = None) -> dict:
    """
    Verify a task completion claim before marking DONE.
    
    This is the key integration point for AGENTS.md accountability.
    """
    # Build context from evidence
    context = "\n".join(evidence or [])
    if not context:
        context = load_context_for_verification()
    
    # Full claim with task context
    full_claim = f"Task {task_id}: {completion_claim}"
    
    # Run CoVe
    result = verify_claim(full_claim, context)
    result["task_id"] = task_id
    
    # Log the verification
    log_verification({"task_id": task_id, "claim": completion_claim}, result, accepted=result.get("verdict") == "VERIFIED")
    
    return result


def log_verification(item: dict, verification: dict, accepted: bool):
    """Log CoVe verification for audit trail."""
    log_entry = {
        "ts": datetime.now().astimezone().isoformat(),
        "item": item,
        "verification": verification,
        "accepted": accepted
    }
    
    COVE_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(COVE_LOG_PATH, "a") as f:
        f.write(json.dumps(log_entry) + "\n")


# ============================================================================
# CLI
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description="Chain-of-Verification for fact checking")
    parser.add_argument("--claim", help="Verify a single claim")
    parser.add_argument("--verify-facts", help="Verify facts from JSONL file")
    parser.add_argument("--task-complete", nargs=2, metavar=("TASK_ID", "CLAIM"),
                        help="Verify task completion claim")
    parser.add_argument("--min-confidence", type=float, default=0.7,
                        help="Minimum confidence threshold (0-1)")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    
    args = parser.parse_args()
    
    if args.claim:
        result = verify_claim(args.claim)
        
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            verdict = result.get("verdict", "UNKNOWN")
            confidence = result.get("confidence", 0)
            icon = {"VERIFIED": "✓", "CONTRADICTED": "✗", "CORRECTED": "~", "UNVERIFIED": "?"}.get(verdict, "?")
            
            print(f"{icon} {verdict} (confidence: {confidence:.0%})")
            print(f"  Claim: {args.claim[:80]}...")
            
            if result.get("issues"):
                print(f"  Issues: {', '.join(result['issues'])}")
            
            if result.get("corrected_claim"):
                print(f"  Corrected: {result['corrected_claim']}")
            
            if result.get("qa_pairs"):
                print(f"  Verification Q&A:")
                for qa in result["qa_pairs"]:
                    print(f"    Q: {qa['question'][:60]}...")
                    print(f"    A: {qa['answer'][:60]}...")
    
    elif args.verify_facts:
        facts_path = Path(args.verify_facts)
        if not facts_path.exists():
            print(f"File not found: {args.verify_facts}", file=sys.stderr)
            sys.exit(1)
        
        facts = []
        with open(facts_path) as f:
            for line in f:
                try:
                    facts.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        
        print(f"Verifying {len(facts)} facts with CoVe...", file=sys.stderr)
        verified = verify_facts_batch(facts, args.min_confidence)
        
        print(f"Verified: {len(verified)}/{len(facts)} passed CoVe", file=sys.stderr)
        
        if args.json:
            print(json.dumps(verified, indent=2))
        else:
            for fact in verified:
                v = fact.get("cove_verification", {})
                print(f"  ✓ {v.get('confidence', 0):.0%}: {fact.get('content', '')[:60]}...")
    
    elif args.task_complete:
        task_id, claim = args.task_complete
        result = verify_task_completion(task_id, claim)
        
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            verdict = result.get("verdict", "UNKNOWN")
            confidence = result.get("confidence", 0)
            
            if verdict == "VERIFIED":
                print(f"✓ Task {task_id} completion VERIFIED ({confidence:.0%})")
            else:
                print(f"✗ Task {task_id} completion NOT VERIFIED: {verdict}")
                if result.get("issues"):
                    print(f"  Issues: {', '.join(result['issues'])}")
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
