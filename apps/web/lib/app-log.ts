export interface AppEvent {
  kind: "signed" | "adjusted" | "paused" | "resumed";
  at: number;
  targetBps?: number;
  triggerBps?: number;
  budgetCNS?: string;
  maxPerActionCNS?: string;
}

interface AppLog {
  events: AppEvent[];
  terms?: AppEvent;
}

function key(userId: string): string {
  return `lifeline.app.${userId}`;
}

function read(userId: string): AppLog {
  if (typeof window === "undefined") return { events: [] };
  try {
    const parsed = JSON.parse(localStorage.getItem(key(userId)) || "{}") as AppLog;
    return { events: Array.isArray(parsed.events) ? parsed.events : [], terms: parsed.terms };
  } catch {
    return { events: [] };
  }
}

function write(userId: string, log: AppLog) {
  localStorage.setItem(key(userId), JSON.stringify({ ...log, events: log.events.slice(-40) }));
}

export function readAppEvents(userId: string): AppEvent[] {
  return read(userId).events;
}

export function writeAppEvent(userId: string, event: AppEvent) {
  const log = read(userId);
  if (event.kind === "paused" || event.kind === "signed" || event.kind === "adjusted") log.terms = event;
  write(userId, { ...log, events: [...log.events, event] });
}

export function readSavedTerms(userId: string): AppEvent | null {
  return read(userId).terms ?? null;
}
