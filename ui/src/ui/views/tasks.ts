import { html, nothing } from "lit";
import type { TasksData, TaskEntry } from "../controllers/tasks.ts";
import { formatRelativeTimestamp } from "../format.ts";

export type TasksProps = {
  loading: boolean;
  data: TasksData | null;
  error: string | null;
  onRefresh: () => void;
};

const LANE_CONFIG: { key: string; label: string; color: string; emoji: string }[] = [
  { key: "bot_current", label: "In Progress", color: "var(--accent)", emoji: "🔵" },
  { key: "bot_queue", label: "Queued", color: "var(--text-muted)", emoji: "⏳" },
  { key: "human", label: "Needs Human", color: "#e6a700", emoji: "🟡" },
  { key: "scheduled", label: "Scheduled", color: "var(--text-muted)", emoji: "📅" },
  { key: "done_today", label: "Done Today", color: "var(--text-muted)", emoji: "✅" },
];

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    in_progress: "var(--accent)",
    blocked: "#e6a700",
    done: "#22c55e",
    pending: "var(--text-muted)",
    queued: "var(--text-muted)",
  };
  const bg = colors[status] ?? "var(--text-muted)";
  return html`<span
    style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:${bg}20;color:${bg};text-transform:uppercase;"
    >${status.replace(/_/g, " ")}</span
  >`;
}

function renderSteps(steps: TaskEntry["steps"], stepIndex?: number) {
  if (!steps || steps.length === 0) {
    return nothing;
  }
  const done = steps.filter((s) => s.checked || s.status === "done").length;
  const total = steps.length;
  const pct = Math.round((done / total) * 100);
  const current =
    stepIndex != null ? steps[stepIndex] : steps.find((s) => s.status === "in_progress");
  return html`
    <div style="margin-top:8px;">
      <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-muted);">
        <span>${done}/${total} steps</span>
        <span style="color:var(--accent);font-weight:600;">${pct}%</span>
      </div>
      <div
        style="margin-top:4px;height:4px;border-radius:2px;background:var(--bg-tertiary);overflow:hidden;"
      >
        <div
          style="height:100%;width:${pct}%;background:var(--accent);border-radius:2px;transition:width 0.3s;"
        ></div>
      </div>
      ${
        current
          ? html`<div
            style="margin-top:6px;font-size:11px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
          >
            ▸ ${current.text}
          </div>`
          : nothing
      }
    </div>
  `;
}

function renderTaskCard(id: string, task: TaskEntry) {
  return html`
    <div class="card" style="margin-bottom:8px;padding:12px 14px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
        <div style="font-weight:600;font-size:13px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;">
          ${task.title}
        </div>
        ${statusBadge(task.status)}
      </div>
      ${
        task.summary
          ? html`<div
            style="margin-top:6px;font-size:12px;color:var(--text-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;"
          >
            ${task.summary}
          </div>`
          : nothing
      }
      ${renderSteps(task.steps, task.step_index)}
      ${
        task.next_action
          ? html`<div style="margin-top:6px;font-size:11px;color:var(--text-muted);">
            Next: ${task.next_action}
          </div>`
          : nothing
      }
      ${
        task.blockers && task.blockers.length > 0
          ? html`<div style="margin-top:6px;font-size:11px;color:#e6a700;">
            🚧 ${task.blockers.length} blocker${task.blockers.length > 1 ? "s" : ""}
          </div>`
          : nothing
      }
      ${
        task.updated_at
          ? html`<div style="margin-top:6px;font-size:10px;color:var(--text-muted);text-align:right;">
            ${formatRelativeTimestamp(new Date(task.updated_at).getTime())}
          </div>`
          : nothing
      }
    </div>
  `;
}

function renderLane(
  laneKey: string,
  label: string,
  emoji: string,
  taskIds: string[],
  tasks: Record<string, TaskEntry>,
) {
  const laneTasks = taskIds.map((id) => ({ id, task: tasks[id] })).filter((t) => t.task);
  return html`
    <div
      style="flex:1;min-width:240px;max-width:360px;background:var(--bg-secondary);border-radius:8px;padding:12px;display:flex;flex-direction:column;"
    >
      <div
        style="display:flex;align-items:center;gap:6px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border);"
      >
        <span style="font-size:16px;">${emoji}</span>
        <span style="font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">
          ${label}
        </span>
        <span
          style="margin-left:auto;background:var(--bg-tertiary);color:var(--text-muted);border-radius:10px;padding:1px 8px;font-size:11px;font-weight:600;"
        >
          ${laneTasks.length}
        </span>
      </div>
      <div style="flex:1;overflow-y:auto;">
        ${
          laneTasks.length === 0
            ? html`
                <div style="text-align: center; color: var(--text-muted); font-size: 12px; padding: 24px 0">
                  No tasks
                </div>
              `
            : laneTasks.map(({ id, task }) => renderTaskCard(id, task))
        }
      </div>
    </div>
  `;
}

export function renderTasks(props: TasksProps) {
  if (props.loading && !props.data) {
    return html`
      <section>
        <div class="card"><div class="card-title">Loading tasks…</div></div>
      </section>
    `;
  }
  if (props.error) {
    return html`<section>
      <div class="card">
        <div class="card-title" style="color:var(--danger);">Error loading tasks</div>
        <div class="card-sub">${props.error}</div>
        <button class="pill" @click=${props.onRefresh} style="margin-top:8px;">Retry</button>
      </div>
    </section>`;
  }
  const data = props.data;
  if (!data) {
    return html`
      <section>
        <div class="card"><div class="card-sub">No task data available.</div></div>
      </section>
    `;
  }

  const lanes = data.lanes ?? {};
  const tasks = data.tasks ?? {};

  return html`
    <section>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div style="font-size:12px;color:var(--text-muted);">
          ${data.version != null ? html`v${data.version} · ` : nothing}
          ${
            data.updated_at
              ? html`Updated ${formatRelativeTimestamp(new Date(data.updated_at).getTime())}`
              : nothing
          }
        </div>
        <button class="pill" @click=${props.onRefresh} ?disabled=${props.loading}>
          ${props.loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <div style="display:flex;gap:12px;overflow-x:auto;padding-bottom:8px;align-items:flex-start;">
        ${LANE_CONFIG.map(({ key, label, emoji }) =>
          renderLane(key, label, emoji, lanes[key] ?? [], tasks),
        )}
      </div>
    </section>
  `;
}
