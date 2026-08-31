export interface EntitySessionCache<T> {
  get: (entityId: string) => T | undefined;
  set: (entityId: string, value: T) => void;
  clear: () => void;
}

/** Shared memory cache for large view state that should survive category switches. */
export function createEntitySessionCache<T>(): EntitySessionCache<T> {
  const entries = new Map<string, T>();
  return {
    get: (entityId) => entries.get(entityId),
    set: (entityId, value) => entries.set(entityId, value),
    clear: () => entries.clear(),
  };
}
