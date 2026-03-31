import type { AuthProfileCredential } from "../agents/auth-profiles.js";
import { resolveAuthStorePath } from "../agents/auth-profiles/paths.js";
import { updateAuthProfileStoreWithLock } from "../agents/auth-profiles/store.js";
import { normalizeProviderId } from "../agents/model-selection.js";
import { shortenHomePath } from "../utils.js";

export type DeferredAuthProfileWrite = {
  kind: "auth-profile";
  agentDir?: string;
  profileId: string;
  credential: AuthProfileCredential;
};

export type AuthConfigWritePlan = {
  writes: DeferredAuthProfileWrite[];
};

export function createAuthConfigWritePlan(): AuthConfigWritePlan {
  return { writes: [] };
}

export function hasDeferredAuthConfigWrites(plan?: AuthConfigWritePlan | null): boolean {
  return Array.isArray(plan?.writes) && plan.writes.length > 0;
}

function normalizeCredential(credential: AuthProfileCredential): AuthProfileCredential {
  return {
    ...credential,
    provider: normalizeProviderId(credential.provider),
  };
}

export function queueAuthProfileWrite(
  plan: AuthConfigWritePlan | undefined,
  params: {
    agentDir?: string;
    profileId: string;
    credential: AuthProfileCredential;
  },
): boolean {
  if (!plan) {
    return false;
  }
  const profileId = params.profileId.trim();
  if (!profileId) {
    throw new Error("Auth profile id is required");
  }
  plan.writes.push({
    kind: "auth-profile",
    agentDir: params.agentDir,
    profileId,
    credential: normalizeCredential(params.credential),
  });
  return true;
}

function buildWriteFailureMessage(params: {
  agentDir?: string;
  profileIds: string[];
  commandHint?: string;
}): string {
  const authPath = shortenHomePath(resolveAuthStorePath(params.agentDir));
  const commandHint = params.commandHint?.trim();
  const profileLabel =
    params.profileIds.length === 1
      ? `profile ${params.profileIds[0]}`
      : `profiles ${params.profileIds.join(", ")}`;
  const retry =
    commandHint && commandHint.length > 0
      ? `Re-run \`${commandHint}\` to retry the credential write.`
      : "Re-run the auth step to retry the credential write.";
  return [
    "Config was saved, but OpenClaw could not finish storing credentials.",
    `Failed writing ${profileLabel} in ${authPath}.`,
    retry,
  ].join(" ");
}

export async function commitAuthConfigWritePlan(
  plan: AuthConfigWritePlan | undefined,
  options: {
    commandHint?: string;
  } = {},
): Promise<void> {
  if (!hasDeferredAuthConfigWrites(plan)) {
    return;
  }

  const pending = [...(plan?.writes ?? [])];
  const grouped = new Map<string, DeferredAuthProfileWrite[]>();

  for (const write of pending) {
    const key = write.agentDir ?? "";
    const writes = grouped.get(key) ?? [];
    const existingIndex = writes.findIndex((entry) => entry.profileId === write.profileId);
    if (existingIndex >= 0) {
      writes[existingIndex] = write;
    } else {
      writes.push(write);
    }
    grouped.set(key, writes);
  }

  for (const [agentDirKey, writes] of grouped.entries()) {
    const agentDir = agentDirKey || undefined;
    const updated = await updateAuthProfileStoreWithLock({
      agentDir,
      updater: (store) => {
        let mutated = false;
        for (const write of writes) {
          const nextCredential = normalizeCredential(write.credential);
          const prev = store.profiles[write.profileId];
          const prevJson = prev ? JSON.stringify(prev) : "";
          const nextJson = JSON.stringify(nextCredential);
          if (prevJson === nextJson) {
            continue;
          }
          store.profiles[write.profileId] = nextCredential;
          mutated = true;
        }
        return mutated;
      },
    });
    if (!updated) {
      throw new Error(
        buildWriteFailureMessage({
          agentDir,
          profileIds: writes.map((entry) => entry.profileId),
          commandHint: options.commandHint,
        }),
      );
    }
  }

  plan!.writes.length = 0;
}
