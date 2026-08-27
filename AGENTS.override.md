# Codex project bootstrap

Read `AGENTS.md` before non-trivial work. It defines the project-specific execution, coordination, verification, durable-learning, and recovery policy. Repository/package documentation remains authoritative for subsystem-specific commands and behavior.

Keep the root agent responsible for objective, authoritative state, approvals, integration, and final verification; delegate only bounded work and isolate concurrent writers.
