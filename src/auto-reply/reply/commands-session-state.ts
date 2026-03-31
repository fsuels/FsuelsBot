import { updateSessionStore, type SessionEntry } from "../../config/sessions.js";

export async function applySessionEntryMutation(params: {
  entry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey?: string;
  storePath?: string;
  mutate: (entry: SessionEntry) => void;
}): Promise<SessionEntry | undefined> {
  const { entry, sessionStore, sessionKey, storePath, mutate } = params;
  if (!entry || !sessionStore || !sessionKey) {
    return entry;
  }

  mutate(entry);
  entry.updatedAt = Date.now();
  sessionStore[sessionKey] = entry;

  if (storePath) {
    await updateSessionStore(storePath, (store) => {
      store[sessionKey] = entry;
    });
  }

  return entry;
}
