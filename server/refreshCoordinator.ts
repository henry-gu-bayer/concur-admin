const pendingRefreshes = new Map<string, Promise<unknown>>();

/** Share one in-flight full refresh per entity/domain to prevent snapshot races. */
export function dedupeRefresh<T>(key: string, task: () => Promise<T>): Promise<T> {
  const existing = pendingRefreshes.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const pending = task().finally(() => {
    if (pendingRefreshes.get(key) === pending) pendingRefreshes.delete(key);
  });
  pendingRefreshes.set(key, pending);
  return pending;
}
