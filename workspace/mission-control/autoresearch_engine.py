#!/usr/bin/env python3
"""
Repo-native autoresearch loop for Mission Control.

This is a practical, file-item-focused implementation of the Karpathy-style
generate -> evaluate -> score -> mutate loop. Mission Control launches runs by
writing a config into `.autoresearch/runs/<run_id>/` and starting this module as
an external process, then polls the JSON status files for progress.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import random
import re
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_BATCH_SIZE = 5
DEFAULT_VALIDATION_COUNT = 3
DEFAULT_MAX_ITEM_CHARS = 6000
DEFAULT_MAX_RUNS = 15
DEFAULT_RUNNER = "codex"

MUTATION_OPERATORS = [
    "add_constraint",
    "add_negative_example",
    "restructure",
    "tighten_language",
    "remove_bloat",
    "add_counterexample",
]

STOP_REQUESTED = False


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def utc_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def load_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default
    except Exception:
        return default


def write_json(path: Path, data: Any) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def append_jsonl(path: Path, data: Any) -> None:
    ensure_dir(path.parent)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(data, ensure_ascii=False) + "\n")


def read_text(path: Path, default: str = "") -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return default


def write_text(path: Path, text: str) -> None:
    ensure_dir(path.parent)
    path.write_text(text, encoding="utf-8")


def tail_lines(path: Path, limit: int = 20) -> list[str]:
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception:
        return []
    return lines[-limit:]


def slugify(value: str) -> str:
    lowered = (value or "").strip().lower()
    lowered = re.sub(r"[^a-z0-9]+", "-", lowered)
    lowered = re.sub(r"-{2,}", "-", lowered).strip("-")
    return lowered or "run"


def strip_code_fences(text: str) -> str:
    trimmed = (text or "").strip()
    if trimmed.startswith("```") and trimmed.endswith("```"):
        inner = trimmed.split("\n", 1)
        if len(inner) == 2:
            trimmed = inner[1]
        trimmed = re.sub(r"\n```$", "", trimmed)
    return trimmed.strip()


def truncate_text(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    head = text[:limit]
    return head + "\n\n[TRUNCATED]"


def extract_json_object(text: str) -> dict[str, Any] | None:
    if not text:
        return None
    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
    except Exception:
        return None
    return parsed if isinstance(parsed, dict) else None


def replace_placeholders(text: str, mapping: dict[str, str]) -> str:
    result = text
    for key, value in mapping.items():
        result = result.replace(f"{{{{{key}}}}}", value)
    return result


def short_preview(text: str, limit: int = 200) -> str:
    compact = re.sub(r"\s+", " ", (text or "").strip())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 3] + "..."


def is_pid_alive(pid: int | None) -> bool:
    if not isinstance(pid, int) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def install_signal_handlers() -> None:
    def _handler(_signum, _frame):
        global STOP_REQUESTED
        STOP_REQUESTED = True

    signal.signal(signal.SIGTERM, _handler)
    signal.signal(signal.SIGINT, _handler)


def resolve_repo_root(from_path: str | Path) -> Path:
    path = Path(from_path).resolve()
    if path.is_file():
        path = path.parent
    return path


def autoresearch_paths(repo_root: str | Path) -> dict[str, Path]:
    root = ensure_dir(resolve_repo_root(repo_root) / ".autoresearch")
    return {
        "root": root,
        "runs": ensure_dir(root / "runs"),
        "active": root / "active.json",
    }


def detect_runner_status() -> list[dict[str, Any]]:
    runners = []
    for runner_id, label in (
        ("codex", "Codex CLI"),
        ("gemini", "Gemini CLI"),
        ("claude", "Claude Code"),
    ):
        binary = shutil.which(runner_id)
        runners.append(
            {
                "id": runner_id,
                "label": label,
                "available": bool(binary),
                "binaryPath": binary,
            }
        )
    return runners


def read_run_status(run_dir: str | Path) -> dict[str, Any] | None:
    path = Path(run_dir) / "status.json"
    data = load_json(path)
    return data if isinstance(data, dict) else None


def list_runs(repo_root: str | Path, limit: int = 10) -> list[dict[str, Any]]:
    runs_dir = autoresearch_paths(repo_root)["runs"]
    results: list[dict[str, Any]] = []
    for child in runs_dir.iterdir() if runs_dir.exists() else []:
        if not child.is_dir():
            continue
        status = read_run_status(child)
        if not status:
            continue
        status["runDir"] = str(child)
        results.append(status)
    results.sort(key=lambda item: item.get("startedAt", ""), reverse=True)
    return results[:limit]


def build_dashboard_status(repo_root: str | Path, limit: int = 6) -> dict[str, Any]:
    paths = autoresearch_paths(repo_root)
    active_meta = load_json(paths["active"], default={})
    active_status = None
    if isinstance(active_meta, dict):
        run_dir = active_meta.get("runDir")
        if isinstance(run_dir, str) and run_dir.strip():
            active_status = read_run_status(Path(run_dir))
            if isinstance(active_status, dict):
                active_status["runDir"] = run_dir
                pid = active_status.get("pid")
                if active_status.get("state") in {"launching", "running"} and not is_pid_alive(pid):
                    active_status["state"] = "stopped"
                    active_status["message"] = "Process is no longer running."
                    active_status["lastUpdatedAt"] = utc_now()
                    write_json(Path(run_dir) / "status.json", active_status)
            else:
                active_status = None

    if not isinstance(active_status, dict):
        if paths["active"].exists():
            try:
                paths["active"].unlink()
            except Exception:
                pass

    recent_runs = list_runs(repo_root, limit=limit)
    return {
        "ok": True,
        "root": str(paths["root"]),
        "active": active_status,
        "recentRuns": recent_runs,
        "runners": detect_runner_status(),
    }


def default_prompt_template(target: str, scope: str, context: str) -> str:
    return (
        "You are participating in an autoresearch optimization loop.\n\n"
        f"Goal: {target or 'Improve output quality'}\n"
        f"Scope: {scope or 'Current item only'}\n"
        f"Context: {context or 'No extra context provided'}\n\n"
        "For the current repository item:\n"
        "- Item path: {{item_path}}\n"
        "- Repository root: {{repo_root}}\n\n"
        "Use the item content below to produce the best possible deliverable for the goal.\n"
        "Return only the deliverable. No commentary, no reasoning preamble.\n\n"
        "Item content:\n"
        "{{item_content}}\n"
    )


def codex_invoke(prompt: str, repo_root: Path, model: str | None, timeout: int) -> str:
    tmp = tempfile.NamedTemporaryFile(prefix="autoresearch-codex-", suffix=".txt", delete=False)
    tmp_path = Path(tmp.name)
    tmp.close()
    cmd = [
        "codex",
        "exec",
        "-C",
        str(repo_root),
        "--skip-git-repo-check",
        "-s",
        "read-only",
        "-o",
        str(tmp_path),
        "-",
    ]
    if model:
        cmd[2:2] = ["-m", model]
    try:
        result = subprocess.run(
            cmd,
            input=prompt,
            text=True,
            capture_output=True,
            cwd=str(repo_root),
            timeout=timeout,
        )
        if result.returncode != 0:
            stderr = short_preview(result.stderr or result.stdout or "Codex invocation failed")
            raise RuntimeError(stderr)
        text = read_text(tmp_path).strip()
        if text:
            return text
        return (result.stdout or "").strip()
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass


def gemini_invoke(prompt: str, repo_root: Path, model: str | None, timeout: int) -> str:
    cmd = ["gemini", "--prompt", prompt, "--output-format", "text"]
    if model:
        cmd.extend(["--model", model])
    result = subprocess.run(
        cmd,
        text=True,
        capture_output=True,
        cwd=str(repo_root),
        timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(short_preview(result.stderr or result.stdout or "Gemini invocation failed"))
    return (result.stdout or "").strip()


def claude_invoke(prompt: str, repo_root: Path, model: str | None, timeout: int) -> str:
    cmd = ["claude", "-p", "--output-format", "text"]
    if model:
        cmd.extend(["--model", model])
    result = subprocess.run(
        cmd,
        input=prompt,
        text=True,
        capture_output=True,
        cwd=str(repo_root),
        timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(short_preview(result.stderr or result.stdout or "Claude invocation failed"))
    return (result.stdout or "").strip()


def invoke_runner(
    runner_type: str,
    prompt: str,
    repo_root: Path,
    model: str | None = None,
    timeout: int = 240,
) -> str:
    runner = (runner_type or DEFAULT_RUNNER).strip().lower()
    if runner == "codex":
        return codex_invoke(prompt, repo_root, model, timeout)
    if runner == "gemini":
        return gemini_invoke(prompt, repo_root, model, timeout)
    if runner == "claude":
        return claude_invoke(prompt, repo_root, model, timeout)
    raise RuntimeError(f"Unsupported runner: {runner}")


def render_prompt(template: str, item_path: str, item_content: str, config: dict[str, Any]) -> str:
    mapping = {
        "item_path": item_path,
        "item_content": item_content,
        "target": str(config.get("target") or ""),
        "scope": str(config.get("scope") or ""),
        "context": str(config.get("context") or ""),
        "repo_root": str(config.get("repo_root") or ""),
    }
    rendered = replace_placeholders(template, mapping)
    if "{{item_content}}" not in template:
        rendered = rendered.rstrip() + "\n\nItem content:\n" + item_content
    return rendered.strip()


def collect_items(config: dict[str, Any]) -> list[str]:
    repo_root = resolve_repo_root(config["repo_root"])
    explicit_items = config.get("item_paths") or []
    item_globs = config.get("item_globs") or []

    discovered: set[str] = set()
    for item in explicit_items:
        path = (repo_root / str(item)).resolve()
        if path.is_file():
            discovered.add(str(path.relative_to(repo_root)))

    for pattern in item_globs:
        absolute_pattern = str((repo_root / str(pattern)).resolve())
        for match in glob.glob(absolute_pattern, recursive=True):
            path = Path(match)
            if not path.is_file():
                continue
            try:
                rel = path.resolve().relative_to(repo_root)
            except Exception:
                continue
            rel_text = str(rel)
            if rel_text.startswith(".autoresearch/"):
                continue
            if "/node_modules/" in rel_text or rel_text.startswith("node_modules/"):
                continue
            if "/dist/" in rel_text or rel_text.startswith("dist/"):
                continue
            discovered.add(rel_text)

    return sorted(discovered)


def choose_batch(all_items: list[str], state: dict[str, Any], batch_size: int) -> list[str]:
    validation_items = [item for item in state.get("validation_items", []) if item in all_items]
    sampled_items = state.get("sampled_items", [])
    rotating_pool = [item for item in all_items if item not in validation_items]
    unseen = [item for item in rotating_pool if item not in sampled_items]
    remaining_slots = max(0, batch_size - len(validation_items))

    if len(unseen) >= remaining_slots:
        rotating = unseen[:remaining_slots]
    else:
        rotating = list(unseen)
        refill = [item for item in rotating_pool if item not in rotating]
        rotating.extend(refill[: max(0, remaining_slots - len(rotating))])

    state["sampled_items"] = list(dict.fromkeys(sampled_items + rotating))
    return validation_items + rotating


def evaluate_llm_judge(
    criterion: dict[str, Any],
    output_text: str,
    item_path: str,
    item_content: str,
    repo_root: Path,
    runner_type: str,
    model: str | None,
) -> dict[str, Any]:
    criterion_text = str(criterion.get("prompt") or criterion.get("criterion") or "").strip()
    judge_prompt = (
        "You are a strict binary evaluator.\n"
        "Evaluate ONLY the candidate output against the criterion below.\n"
        "If it is not clearly passing, fail it.\n"
        'Return only valid JSON: {"pass": true|false, "reason": "short reason"}.\n\n'
        f"Criterion name: {criterion.get('name', 'Unnamed criterion')}\n"
        f"Criterion: {criterion_text}\n\n"
        f"Source item path: {item_path}\n\n"
        "Source item content:\n"
        f"{item_content}\n\n"
        "Candidate output:\n"
        f"{output_text}\n"
    )
    raw = invoke_runner(runner_type, judge_prompt, repo_root, model=model, timeout=180)
    parsed = extract_json_object(raw)
    if not parsed:
        return {
            "pass": False,
            "reason": f"Judge returned non-JSON output: {short_preview(raw, 140)}",
            "raw": raw,
        }
    return {
        "pass": bool(parsed.get("pass")),
        "reason": str(parsed.get("reason") or "").strip() or "No reason returned.",
        "raw": raw,
    }


def evaluate_command(
    criterion: dict[str, Any],
    output_text: str,
    output_file: Path,
    item_path: str,
    repo_root: Path,
) -> dict[str, Any]:
    write_text(output_file, output_text)
    command = str(criterion.get("command") or "").strip()
    command = replace_placeholders(
        command,
        {
            "output_file": shlex.quote(str(output_file)),
            "item_path": shlex.quote(item_path),
            "repo_root": shlex.quote(str(repo_root)),
        },
    )

    attempts = []
    flaky = False
    for attempt in range(2):
        result = subprocess.run(
            ["/bin/zsh", "-lc", command],
            text=True,
            capture_output=True,
            cwd=str(repo_root),
            timeout=120,
        )
        attempts.append(result)
        if result.returncode == 0:
            flaky = attempt == 1
            break
    final = attempts[-1]
    return {
        "pass": final.returncode == 0,
        "reason": short_preview(final.stderr or final.stdout or "Command produced no output", 220),
        "command": command,
        "flaky": flaky,
    }


def mutate_prompt(
    runner_type: str,
    repo_root: Path,
    model: str | None,
    base_prompt: str,
    target: str,
    scope: str,
    context: str,
    failures: list[str],
    criterion_totals: dict[str, int],
    max_score: int,
    score: int,
    operator: str,
) -> str:
    weakest = sorted(criterion_totals.items(), key=lambda item: item[1])[:3]
    mutation_prompt = (
        "You are improving an autoresearch prompt.\n"
        "Return only the new prompt text. No fences, no commentary.\n"
        f"Mutation operator: {operator}\n"
        f"Goal: {target}\n"
        f"Scope: {scope}\n"
        f"Context: {context}\n"
        f"Score this run: {score}/{max_score}\n\n"
        "Current best/base prompt:\n"
        f"{base_prompt}\n\n"
        "Weakest criteria:\n"
        + "\n".join(f"- {name}: {count}" for name, count in weakest)
        + "\n\nCommon failures:\n"
        + ("\n".join(f"- {failure}" for failure in failures[:8]) or "- None recorded")
        + "\n\nRules:\n"
        "- Keep placeholders like {{item_path}} and {{item_content}} if present.\n"
        "- Prefer shorter prompts when possible.\n"
        "- Make the instructions more robust against the listed failures.\n"
    )
    raw = invoke_runner(runner_type, mutation_prompt, repo_root, model=model, timeout=240)
    mutated = strip_code_fences(raw)
    return mutated or base_prompt


def init_state(run_dir: Path, config: dict[str, Any], all_items: list[str]) -> dict[str, Any]:
    validation_count = max(1, int(config.get("validation_count") or DEFAULT_VALIDATION_COUNT))
    validation_items = all_items[:validation_count]
    if not validation_items:
        raise RuntimeError("No matching items found for autoresearch.")

    prompt_template = str(config.get("prompt_template") or "").strip()
    if not prompt_template:
        prompt_template = default_prompt_template(
            str(config.get("target") or ""),
            str(config.get("scope") or ""),
            str(config.get("context") or ""),
        )

    state = {
        "run_number": 0,
        "best_score": -1,
        "best_validation_score": -1,
        "plateau_counter": 0,
        "perfect_streak": 0,
        "sampled_items": [],
        "item_failures": {},
        "validation_items": validation_items,
        "all_items": all_items,
        "criteria_count": len(config.get("criteria") or []),
    }
    write_json(run_dir / "state.json", state)
    write_text(run_dir / "prompt.txt", prompt_template)
    write_text(run_dir / "best_prompt.txt", prompt_template)
    return state


def update_status(run_dir: Path, **updates: Any) -> dict[str, Any]:
    status_path = run_dir / "status.json"
    current = load_json(status_path, default={})
    if not isinstance(current, dict):
        current = {}
    current.update(updates)
    current["lastUpdatedAt"] = utc_now()
    write_json(status_path, current)
    return current


def run_engine(run_dir: Path) -> int:
    install_signal_handlers()
    config = load_json(run_dir / "config.json")
    if not isinstance(config, dict):
        raise RuntimeError("Missing or invalid config.json")

    repo_root = resolve_repo_root(config["repo_root"])
    runner_type = str((config.get("runner") or {}).get("type") or DEFAULT_RUNNER).strip().lower()
    model = str((config.get("runner") or {}).get("model") or "").strip() or None
    batch_size = max(1, int(config.get("batch_size") or DEFAULT_BATCH_SIZE))
    max_runs = max(1, int(config.get("max_runs") or DEFAULT_MAX_RUNS))
    max_item_chars = max(1000, int(config.get("max_item_chars") or DEFAULT_MAX_ITEM_CHARS))
    criteria = config.get("criteria") or []
    if not isinstance(criteria, list) or not criteria:
        raise RuntimeError("At least one evaluation criterion is required.")

    results_path = run_dir / "results.jsonl"
    outputs_dir = ensure_dir(run_dir / "outputs")
    stop_file = run_dir / "STOP"
    active_file = autoresearch_paths(repo_root)["active"]

    all_items = collect_items(config)
    state = load_json(run_dir / "state.json")
    if not isinstance(state, dict):
        state = init_state(run_dir, config, all_items)

    update_status(
        run_dir,
        state="running",
        runId=config.get("run_id"),
        name=config.get("name"),
        target=config.get("target"),
        scope=config.get("scope"),
        context=config.get("context"),
        runnerType=runner_type,
        model=model,
        repoRoot=str(repo_root),
        startedAt=utc_now(),
        pid=os.getpid(),
        message="Autoresearch loop running.",
    )

    while True:
        if STOP_REQUESTED or stop_file.exists():
            update_status(run_dir, state="stopped", message="Stop requested.")
            break
        if state.get("run_number", 0) >= max_runs:
            update_status(run_dir, state="completed", message="Reached configured max runs.")
            break

        all_items = collect_items(config)
        if not all_items:
            update_status(run_dir, state="failed", message="No matching items found.")
            break
        state["all_items"] = all_items
        state["validation_items"] = [item for item in state.get("validation_items", []) if item in all_items]
        if not state["validation_items"]:
            state["validation_items"] = all_items[: max(1, int(config.get("validation_count") or DEFAULT_VALIDATION_COUNT))]

        prompt_text = read_text(run_dir / "prompt.txt")
        best_prompt = read_text(run_dir / "best_prompt.txt") or prompt_text
        batch_items = choose_batch(all_items, state, batch_size)
        if not batch_items:
            update_status(run_dir, state="failed", message="Batch selection returned no items.")
            break

        run_number = int(state.get("run_number", 0)) + 1
        cycle_dir = ensure_dir(outputs_dir / f"run-{run_number:04d}")
        criterion_totals = {str(c.get("name") or f"criterion-{idx+1}"): 0 for idx, c in enumerate(criteria)}
        failures: list[str] = []
        flagged_items: list[str] = []
        flaky_commands: list[str] = []
        item_results: list[dict[str, Any]] = []
        validation_score = 0
        validation_set = set(state.get("validation_items", []))

        update_status(
            run_dir,
            state="running",
            cycle=run_number,
            batchItems=batch_items,
            message=f"Running cycle {run_number} on {len(batch_items)} items.",
        )

        for index, item_path in enumerate(batch_items, start=1):
            if STOP_REQUESTED or stop_file.exists():
                update_status(run_dir, state="stopped", message="Stop requested mid-cycle.")
                break

            source_path = repo_root / item_path
            if not source_path.exists():
                failures.append(f"{item_path}: file no longer exists")
                continue

            item_content = truncate_text(read_text(source_path), max_item_chars)
            generated = invoke_runner(
                runner_type,
                render_prompt(prompt_text, item_path, item_content, config),
                repo_root,
                model=model,
                timeout=300,
            )
            output_file = cycle_dir / f"{slugify(item_path)}.txt"
            write_text(output_file, generated)

            per_criterion: list[dict[str, Any]] = []
            item_score = 0
            for crit_index, criterion in enumerate(criteria, start=1):
                criterion_name = str(criterion.get("name") or f"criterion-{crit_index}")
                criterion_type = str(criterion.get("type") or "llm_judge").strip().lower()

                if criterion_type == "command":
                    evaluation = evaluate_command(
                        criterion=criterion,
                        output_text=generated,
                        output_file=output_file,
                        item_path=item_path,
                        repo_root=repo_root,
                    )
                    if evaluation.get("flaky"):
                        flaky_commands.append(evaluation.get("command") or criterion_name)
                else:
                    evaluation = evaluate_llm_judge(
                        criterion=criterion,
                        output_text=generated,
                        item_path=item_path,
                        item_content=item_content,
                        repo_root=repo_root,
                        runner_type=runner_type,
                        model=model,
                    )

                pair_key = f"{item_path}:{criterion_name}"
                if evaluation.get("pass"):
                    criterion_totals[criterion_name] += 1
                    item_score += 1
                else:
                    failures.append(f"{criterion_name} @ {item_path}: {evaluation.get('reason')}")
                    count = int(state.get("item_failures", {}).get(pair_key, 0)) + 1
                    state.setdefault("item_failures", {})[pair_key] = count
                    if count >= 5:
                        flagged_items.append(pair_key)

                per_criterion.append(
                    {
                        "name": criterion_name,
                        "type": criterion_type,
                        "pass": bool(evaluation.get("pass")),
                        "reason": evaluation.get("reason"),
                        "command": evaluation.get("command"),
                        "flaky": evaluation.get("flaky", False),
                    }
                )

            if item_path in validation_set:
                validation_score += item_score

            item_results.append(
                {
                    "item": item_path,
                    "outputFile": str(output_file),
                    "score": item_score,
                    "criteria": per_criterion,
                    "outputPreview": short_preview(generated, 240),
                }
            )

            update_status(
                run_dir,
                state="running",
                cycle=run_number,
                currentItem=item_path,
                currentItemIndex=index,
                currentItemTotal=len(batch_items),
                lastOutputPreview=short_preview(generated, 240),
            )

        if STOP_REQUESTED or stop_file.exists():
            update_status(run_dir, state="stopped", message="Stop requested.")
            break

        max_score = len(batch_items) * len(criteria)
        validation_max = len(validation_set) * len(criteria)
        total_score = sum(criterion_totals.values())
        confidence_margin = 2 if len(batch_items) <= 7 else 1
        previous_best_validation = int(state.get("best_validation_score", -1))
        keep = previous_best_validation < 0 or (validation_score - previous_best_validation) >= confidence_margin
        status_name = "keep" if keep else "discard"

        if keep:
            state["best_score"] = total_score
            state["best_validation_score"] = validation_score
            state["plateau_counter"] = 0
            write_text(run_dir / "best_prompt.txt", prompt_text)
        else:
            state["plateau_counter"] = int(state.get("plateau_counter", 0)) + 1

        if validation_max > 0 and validation_score >= validation_max:
            state["perfect_streak"] = int(state.get("perfect_streak", 0)) + 1
        else:
            state["perfect_streak"] = 0

        mutation_operator = None
        next_prompt = read_text(run_dir / "best_prompt.txt") or prompt_text
        if state["perfect_streak"] < 3 and run_number < max_runs:
            if int(state.get("plateau_counter", 0)) >= 5:
                mutation_operator = "plateau_break"
                state["plateau_counter"] = 0
            else:
                mutation_operator = MUTATION_OPERATORS[(run_number - 1) % len(MUTATION_OPERATORS)]
            next_prompt = mutate_prompt(
                runner_type=runner_type,
                repo_root=repo_root,
                model=model,
                base_prompt=read_text(run_dir / "best_prompt.txt") or prompt_text,
                target=str(config.get("target") or ""),
                scope=str(config.get("scope") or ""),
                context=str(config.get("context") or ""),
                failures=failures,
                criterion_totals=criterion_totals,
                max_score=max_score,
                score=total_score,
                operator=mutation_operator,
            )
            write_text(run_dir / "prompt.txt", next_prompt)

        result_entry = {
            "run": run_number,
            "timestamp": utc_now(),
            "score": total_score,
            "validation_score": validation_score,
            "max": max_score,
            "validation_max": validation_max,
            "criteria": criterion_totals,
            "status": status_name,
            "mutation_operator": mutation_operator,
            "prompt_len": len(prompt_text),
            "prompt_text": prompt_text,
            "failures": failures[:20],
            "items_flagged": flagged_items[:20],
            "flaky_commands": flaky_commands[:20],
            "items": item_results,
        }
        append_jsonl(results_path, result_entry)

        state["run_number"] = run_number
        write_json(run_dir / "state.json", state)

        update_status(
            run_dir,
            state="running",
            cycle=run_number,
            score=total_score,
            maxScore=max_score,
            validationScore=validation_score,
            validationMax=validation_max,
            bestScore=state.get("best_score"),
            bestValidationScore=state.get("best_validation_score"),
            lastStatus=status_name,
            message=f"Cycle {run_number}: {total_score}/{max_score} ({status_name.upper()})",
            mutationOperator=mutation_operator,
            criterionTotals=criterion_totals,
            topFailures=failures[:5],
            lastRunResult=result_entry,
            resultsPath=str(results_path),
            runDir=str(run_dir),
        )

        if state.get("perfect_streak", 0) >= 3:
            update_status(run_dir, state="completed", message="Perfect score reached three runs in a row.")
            break

    active = load_json(active_file, default={})
    if isinstance(active, dict) and active.get("runId") == config.get("run_id"):
        try:
            active_file.unlink(missing_ok=True)
        except Exception:
            pass
    return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Mission Control autoresearch engine")
    sub = parser.add_subparsers(dest="command", required=True)
    run_parser = sub.add_parser("run", help="Run an autoresearch job")
    run_parser.add_argument("--run-dir", required=True, help="Path to a run directory")
    status_parser = sub.add_parser("status", help="Read dashboard status for a repo root")
    status_parser.add_argument("--repo-root", required=True, help="Repo root")
    status_parser.add_argument("--limit", type=int, default=6, help="Recent runs to return")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    if args.command == "status":
        payload = build_dashboard_status(args.repo_root, limit=args.limit)
        sys.stdout.write(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
        return 0
    if args.command == "run":
        try:
            return run_engine(Path(args.run_dir).resolve())
        except Exception as exc:
            run_dir = Path(args.run_dir).resolve()
            update_status(run_dir, state="failed", message=str(exc), errorType=type(exc).__name__)
            raise
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
