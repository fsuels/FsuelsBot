import json, pathlib, datetime
ledger_path = pathlib.Path(r"C:\dev\FsuelsBot\workspace\memory\ledger.jsonl")
existing = ledger_path.read_text(encoding="utf-8").splitlines()
now = datetime.datetime.now(datetime.UTC).isoformat().replace('+00:00','Z')
new = [
  {"ts": now, "kind": "tooling_fix", "fact": "Added scripts/nonstop-guard.ps1 because watchdog referenced a missing file; prevents stall detection from failing.", "source_session": "current"},
  {"ts": now, "kind": "tool_bug", "fact": "On Windows, clawdhub update --all fails due to relative URL parse error; avoid update --all until fixed; use other install/update paths.", "source_session": "current"},
  {"ts": now, "kind": "tool_status", "fact": "In this runtime, inline PowerShell with $var assignments may get variable stripped (e.g., '$x=1' becomes '=1'); prefer file-based scripts or Python for automation.", "source_session": "current"}
]
with ledger_path.open("a", encoding="utf-8") as f:
    for ev in new:
        f.write(json.dumps(ev, ensure_ascii=False) + "\n")
print(f"appended {len(new)} ledger lines; total now {len(existing)+len(new)}")
