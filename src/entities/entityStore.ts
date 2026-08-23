export interface ConcurEntity {
  id: string;
  label: string;
}

let entities: ConcurEntity[] = [];
let activeEntityId = '';
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

export async function initEntities(): Promise<void> {
  const response = await fetch('/api/local/entities', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Unable to load Concur entities: HTTP ${response.status}`);
  const payload = await response.json() as { entities?: ConcurEntity[] };
  entities = payload.entities ?? [];
  activeEntityId = entities[0]?.id ?? '';
  notify();
}

export function getEntities(): ConcurEntity[] {
  return entities;
}

export function getActiveEntityId(): string {
  return activeEntityId;
}

export function setActiveEntity(entityId: string): void {
  if (!entities.length || entities.some((entity) => entity.id === entityId)) {
    activeEntityId = entityId;
    notify();
  }
}

export function subscribeEntities(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function entityRequestHeaders(entityId = activeEntityId): Record<string, string> {
  return entityId ? { 'X-Concur-Entity': entityId } : {};
}
