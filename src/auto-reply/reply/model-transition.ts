import type { SessionEntry } from "../../config/sessions.js";
import type { ModelDirectiveSelection } from "./model-selection.js";
import { applyModelOverrideToSessionEntry } from "../../sessions/model-overrides.js";

export type SessionModelSelectionTransition = {
  provider: string;
  model: string;
  previousLabel: string;
  nextLabel: string;
  modelChanged: boolean;
  updated: boolean;
};

export function applySessionModelSelectionTransition(params: {
  entry: SessionEntry;
  selection: ModelDirectiveSelection;
  profileOverride?: string;
  currentProvider: string;
  currentModel: string;
}): SessionModelSelectionTransition {
  const previousLabel = `${params.currentProvider}/${params.currentModel}`;
  const { updated } = applyModelOverrideToSessionEntry({
    entry: params.entry,
    selection: params.selection,
    profileOverride: params.profileOverride,
  });
  const provider = params.selection.provider;
  const model = params.selection.model;
  const nextLabel = `${provider}/${model}`;
  return {
    provider,
    model,
    previousLabel,
    nextLabel,
    modelChanged: nextLabel !== previousLabel,
    updated,
  };
}
