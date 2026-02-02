type SessionTranscriptUpdate = {
  sessionFile: string;
  taskId: string;
};

type SessionTranscriptListener = (update: SessionTranscriptUpdate) => void;

const SESSION_TRANSCRIPT_LISTENERS = new Set<SessionTranscriptListener>();

export function onSessionTranscriptUpdate(listener: SessionTranscriptListener): () => void {
  SESSION_TRANSCRIPT_LISTENERS.add(listener);
  return () => {
    SESSION_TRANSCRIPT_LISTENERS.delete(listener);
  };
}

export function emitSessionTranscriptUpdate(update: SessionTranscriptUpdate): void {
  const sessionFile = update.sessionFile.trim();
  const taskId = update.taskId.trim();
  if (!sessionFile || !taskId) return;
  const payload = { sessionFile, taskId };
  for (const listener of SESSION_TRANSCRIPT_LISTENERS) {
    listener(payload);
  }
}
