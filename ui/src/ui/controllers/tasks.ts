import type { GatewayBrowserClient } from "../gateway.ts";

export type TaskStep = {
  id: string;
  text: string;
  status: string;
  checked: boolean;
};

export type TaskEntry = {
  title: string;
  status: string;
  lane: string;
  updated_at?: string;
  created_at?: string;
  started_at?: string;
  kind?: string;
  steps?: TaskStep[];
  summary?: string;
  next_action?: string;
  progress?: string;
  blockers?: string[];
  file?: string;
  step_index?: number;
};

export type TasksData = {
  version?: number;
  updated_at?: string;
  lanes: Record<string, string[]>;
  tasks: Record<string, TaskEntry>;
};

export type TasksState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  tasksLoading: boolean;
  tasksData: TasksData | null;
  tasksError: string | null;
};

export async function loadTasks(state: TasksState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.tasksLoading) {
    return;
  }
  state.tasksLoading = true;
  state.tasksError = null;
  try {
    const res = await state.client.request<TasksData>("tasks.get", {});
    state.tasksData = res;
  } catch (err) {
    state.tasksError = String(err);
  } finally {
    state.tasksLoading = false;
  }
}
