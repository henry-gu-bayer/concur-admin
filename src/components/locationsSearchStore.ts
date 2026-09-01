import { fetchAllLocations, refreshLocationsSnapshot, searchLocations } from '../api/locationsApi';
import type { LocationsProgressUpdate } from '../api/locationsApi';
import type { ConcurLocation, LocationQuery, LocationSearchResult, LocationsTaskProgress } from '../types';
import { downloadLocationsCsv } from './locationsCsv';

export type LocationSort = { id: 'name' | 'locCode'; dir: 1 | -1 } | null;
export type LocationsTaskAction = 'search' | 'load-all' | 'refresh' | 'export' | null;
export type LocationsTaskPhase = 'idle' | 'retrieving-locations' | 'matching-localities' | 'ready' | 'error';

/**
 * Page retrieval owns 0-70% and locality matching the rest. The split is by
 * observed cost: on a large country the matching pass is the longer half of the
 * wait, but only page retrieval can stall on a single slow request.
 */
const STAGE_ONE_WEIGHT = 70;

export interface LocationsSearchState {
  country: string;
  subdivision: string;
  city: string;
  name: string;
  result: LocationSearchResult | null;
  lastQuery: LocationQuery | null;
  selectedId: string | null;
  sort: LocationSort;
  action: LocationsTaskAction;
  phase: LocationsTaskPhase;
  progress: LocationsTaskProgress | null;
  error: string | null;
  updatedAt: string | null;
}

interface RunningJob {
  generation: number;
  key: string;
  promise: Promise<void>;
  controller: AbortController;
}

const states = new Map<string, LocationsSearchState>();
const listeners = new Map<string, Set<() => void>>();
const jobs = new Map<string, RunningJob>();
const generations = new Map<string, number>();

function initialState(): LocationsSearchState {
  return {
    country: '', subdivision: '', city: '', name: '',
    result: null, lastQuery: null, selectedId: null, sort: null,
    action: null, phase: 'idle', progress: null, error: null, updatedAt: null,
  };
}

function ensureState(entityId: string): LocationsSearchState {
  const existing = states.get(entityId);
  if (existing) return existing;
  const created = initialState();
  states.set(entityId, created);
  return created;
}

function emit(entityId: string): void {
  listeners.get(entityId)?.forEach((listener) => listener());
}

function patchState(entityId: string, patch: Partial<LocationsSearchState>): void {
  states.set(entityId, { ...ensureState(entityId), ...patch });
  emit(entityId);
}

function nextGeneration(entityId: string): number {
  const generation = (generations.get(entityId) ?? 0) + 1;
  generations.set(entityId, generation);
  return generation;
}

function isCurrent(entityId: string, generation: number): boolean {
  return generations.get(entityId) === generation;
}

function queryFromState(state: LocationsSearchState): LocationQuery {
  return {
    country: state.country.trim().toUpperCase() || undefined,
    countrySubdivision: state.subdivision.trim().toUpperCase() || undefined,
    city: state.city.trim() || undefined,
    name: state.name.trim() || undefined,
  };
}

function queryKey(query: LocationQuery): string {
  return JSON.stringify(query);
}

/** Null means the current stage has no denominator, so the bar stays indeterminate. */
function weightedPercent(update: LocationsProgressUpdate): number | null {
  if (update.stage === 'retrieving-locations') {
    const total = update.pagesTotal ?? null;
    if (total === null || total <= 0) return null;
    return Math.min(STAGE_ONE_WEIGHT, Math.round(((update.pagesDone ?? 0) / total) * STAGE_ONE_WEIGHT));
  }
  const total = update.groupsTotal ?? null;
  if (total === null) return STAGE_ONE_WEIGHT;
  if (total <= 0) return 100;
  return STAGE_ONE_WEIGHT + Math.round(((update.groupsDone ?? 0) / total) * (100 - STAGE_ONE_WEIGHT));
}

function applyProgress(entityId: string, update: LocationsProgressUpdate): void {
  const previous = ensureState(entityId).progress;
  const raw = weightedPercent(update);
  // The page-count estimate can be revised downward mid-run; never let that
  // pull the bar backwards.
  const percent = raw === null
    ? previous?.percent ?? null
    : previous?.percent != null ? Math.max(previous.percent, raw) : raw;
  patchState(entityId, {
    progress: {
      stage: update.stage,
      percent,
      pagesDone: update.pagesDone ?? previous?.pagesDone ?? 0,
      pagesTotal: update.pagesTotal ?? previous?.pagesTotal ?? null,
      rowsDone: update.rowsDone ?? previous?.rowsDone ?? 0,
      groupsDone: update.groupsDone ?? previous?.groupsDone ?? 0,
      groupsTotal: update.groupsTotal ?? previous?.groupsTotal ?? null,
      startedAt: previous?.startedAt ?? Date.now(),
    },
  });
}

function taskOptions(entityId: string, generation: number, signal: AbortSignal) {
  return {
    entityId,
    signal,
    onPhase: (phase: 'retrieving-locations' | 'matching-localities') => {
      if (isCurrent(entityId, generation)) patchState(entityId, { phase });
    },
    onProgress: (update: LocationsProgressUpdate) => {
      if (isCurrent(entityId, generation)) applyProgress(entityId, update);
    },
  };
}

function sortLocationRows(locations: ConcurLocation[], sort: LocationSort): ConcurLocation[] {
  if (!sort) return locations;
  return [...locations].sort((a, b) => {
    const aValue = sort.id === 'name' ? (a.Name ?? '') : (a.LocCode ?? '');
    const bValue = sort.id === 'name' ? (b.Name ?? '') : (b.LocCode ?? '');
    return aValue.localeCompare(bValue) * sort.dir;
  });
}

function beginJob(entityId: string, key: string, action: Exclude<LocationsTaskAction, null>, work: (generation: number, signal: AbortSignal) => Promise<void>): Promise<void> {
  const current = jobs.get(entityId);
  if (current?.key === key) return current.promise;
  current?.controller.abort();
  const generation = nextGeneration(entityId);
  const controller = new AbortController();
  // Reset before the work starts. Patching afterwards would discard any
  // progress a task reports synchronously on its first tick.
  patchState(entityId, { action, phase: 'retrieving-locations', progress: null, error: null });
  const promise = work(generation, controller.signal).finally(() => {
    if (jobs.get(entityId)?.generation === generation) jobs.delete(entityId);
  });
  jobs.set(entityId, { generation, key, promise, controller });
  return promise;
}

export function getLocationsSearchSnapshot(entityId: string): LocationsSearchState {
  return ensureState(entityId);
}

export function subscribeLocationsSearch(entityId: string, listener: () => void): () => void {
  const entityListeners = listeners.get(entityId) ?? new Set<() => void>();
  entityListeners.add(listener);
  listeners.set(entityId, entityListeners);
  return () => entityListeners.delete(listener);
}

export function updateLocationsDraft(entityId: string, patch: Partial<Pick<LocationsSearchState, 'country' | 'subdivision' | 'city' | 'name'>>): void {
  patchState(entityId, patch);
}

export function selectLocation(entityId: string, selectedId: string | null): void {
  patchState(entityId, { selectedId });
}

export function setLocationsSort(entityId: string, sort: LocationSort): void {
  patchState(entityId, { sort });
}

export function startLocationsSearch(entityId: string): Promise<void> {
  const query = queryFromState(ensureState(entityId));
  const key = `search:${queryKey(query)}`;
  return beginJob(entityId, key, 'search', async (generation, signal) => {
    patchState(entityId, { selectedId: null });
    try {
      const result = await searchLocations(query, taskOptions(entityId, generation, signal));
      if (!isCurrent(entityId, generation)) return;
      patchState(entityId, {
        result, lastQuery: query, action: null, phase: 'ready', progress: null, error: null,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (!isCurrent(entityId, generation)) return;
      patchState(entityId, { result: null, action: null, phase: 'error', progress: null, error: error instanceof Error ? error.message : String(error) });
    }
  });
}

export function loadAllLocationResults(entityId: string): Promise<void> {
  const state = ensureState(entityId);
  if (!state.lastQuery) return Promise.resolve();
  const key = `load-all:${queryKey(state.lastQuery)}`;
  return beginJob(entityId, key, 'load-all', async (generation, signal) => {
    try {
      const result = await fetchAllLocations(state.lastQuery!, taskOptions(entityId, generation, signal));
      if (!isCurrent(entityId, generation)) return;
      patchState(entityId, { result, action: null, phase: 'ready', progress: null, error: null, updatedAt: new Date().toISOString() });
    } catch (error) {
      if (!isCurrent(entityId, generation)) return;
      patchState(entityId, { action: null, phase: 'error', progress: null, error: error instanceof Error ? error.message : String(error) });
    }
  });
}

export function refreshLocationResults(entityId: string): Promise<void> {
  const state = ensureState(entityId);
  if (!state.lastQuery?.country) {
    // Refreshing rewrites one country's snapshot, so without a country there is
    // nothing to refresh. Say so rather than resolving to a silent no-op.
    patchState(entityId, { phase: 'error', error: 'Search a country before refreshing its snapshot from Concur.' });
    return Promise.resolve();
  }
  const key = `refresh:${queryKey(state.lastQuery)}`;
  return beginJob(entityId, key, 'refresh', async (generation, signal) => {
    try {
      const result = await refreshLocationsSnapshot(state.lastQuery!, taskOptions(entityId, generation, signal));
      if (!isCurrent(entityId, generation)) return;
      patchState(entityId, {
        result, selectedId: null, action: null, phase: 'ready', progress: null, error: null,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (!isCurrent(entityId, generation)) return;
      patchState(entityId, { action: null, phase: 'error', progress: null, error: error instanceof Error ? error.message : String(error) });
    }
  });
}

export function exportLocationResults(entityId: string): Promise<void> {
  const state = ensureState(entityId);
  if (!state.result?.locations.length) return Promise.resolve();
  const key = `export:${queryKey(state.lastQuery ?? {})}`;
  return beginJob(entityId, key, 'export', async (generation, signal) => {
    try {
      let result = state.result!;
      if (result.hasMore && state.lastQuery) {
        result = await fetchAllLocations(state.lastQuery, taskOptions(entityId, generation, signal));
        if (!isCurrent(entityId, generation)) return;
        patchState(entityId, { result });
      }
      downloadLocationsCsv(sortLocationRows(result.locations, ensureState(entityId).sort));
      if (isCurrent(entityId, generation)) patchState(entityId, { action: null, phase: 'ready', progress: null, error: null, updatedAt: new Date().toISOString() });
    } catch (error) {
      if (!isCurrent(entityId, generation)) return;
      patchState(entityId, { action: null, phase: 'error', progress: null, error: error instanceof Error ? error.message : String(error) });
    }
  });
}

export function cancelLocationsTask(entityId: string): void {
  jobs.get(entityId)?.controller.abort();
  jobs.delete(entityId);
  nextGeneration(entityId);
  const state = ensureState(entityId);
  patchState(entityId, { action: null, phase: state.result ? 'ready' : 'idle', progress: null, error: null });
}

export function resetLocationsSearchStore(): void {
  jobs.forEach((job) => job.controller.abort());
  states.clear();
  jobs.clear();
  generations.clear();
  listeners.forEach((entityListeners) => entityListeners.forEach((listener) => listener()));
}
