import { useEffect, useState } from 'react';
import { ArrowClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowClockwise';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import type { ConcurList, ConcurListItemV3, ConcurListV3 } from '../types';
import { refreshListItems } from '../api/listItemsApi';
import { getListItemsV3, refreshListItemsV3 } from '../api/listItemsV3Api';
import { listName } from '../api/listsApi';
import { ListItemsTree, type PairedListItem } from './ListItemsTree';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { ListMetadataComparison, RecordFieldTable, ResourceFeedback, TechnicalRecord, recordData, useListResource } from './ListRecordFields';

/**
 * One version's side of a selected item. Both sides stay visible at once —
 * the point of this panel is comparing what Concur stores in v4 and v3, so
 * collapsing them into tabs would hide half the answer.
 */
function VersionDetails({ version, record, listRecord, entityId }: { version: 'v4' | 'v3'; record: Record<string, unknown>; listRecord: Record<string, unknown> | null; entityId: string }) {
  const resolved = useListResource(record, entityId);
  return <section aria-label={`${version} item data`} className="min-w-0 rounded-md border">
    <h4 className="border-b bg-muted/20 px-3 py-2 text-xs font-semibold">{version} data</h4>
    <div className="p-3">
      <ResourceFeedback {...resolved} />
      <h5 className="mb-2 text-xs font-semibold">Item information ({version})</h5>
      <RecordFieldTable label={`${version} item fields`} record={resolved.data} />
      <h5 className="mb-2 mt-3 text-xs font-semibold">Related list information ({version})</h5>
      <RecordFieldTable label={`${version} related list fields`} record={listRecord} />
      <TechnicalRecord record={resolved.data} />
    </div>
  </section>;
}

function MissingVersion({ version }: { version: 'v4' | 'v3' }) {
  return <section aria-label={`${version} item data`} className="min-w-0 rounded-md border border-dashed px-3 py-6 text-xs text-muted-foreground">
    This item has no {version} counterpart in this list.
  </section>;
}

function SelectedItemDetails({ row, entityId, listV3, listV4, onClose }: { row: PairedListItem; entityId: string; listV3: Record<string, unknown> | null; listV4: Record<string, unknown> | null; onClose: () => void }) {
  return <section aria-label="Item details" className="mt-4 overflow-hidden rounded-md border bg-card">
    <header className="flex flex-wrap items-start justify-between gap-2 border-b bg-muted/20 px-3 py-2.5">
      <div className="min-w-0">
        <h3 className="min-w-0 break-words text-sm font-semibold">{row.name}{row.code ? ` (${row.code})` : ''}</h3>
        {/* Both IDs in the header: the list shows what an administrator reads
            (name and code), while the technical identity of each source record
            is one glance away and copied from here. */}
        <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <div className="flex gap-1"><dt>v4 ID:</dt><dd className="select-text font-mono break-all">{row.v4?.id ?? 'Not available'}</dd></div>
          <div className="flex gap-1"><dt>v3 ID:</dt><dd className="select-text font-mono break-all">{row.v3?.ID ?? 'Not available'}</dd></div>
        </dl>
      </div>
      <Button type="button" size="icon" variant="ghost" aria-label="Close item details" onClick={onClose}><XIcon size={16} /></Button>
    </header>
    {/* Stacked rather than side by side: the detail pane can be as narrow as
        320px, where two versions abreast would each be unreadable. */}
    <div className="grid gap-3 p-3">
      {row.v4 ? <VersionDetails version="v4" record={row.v4 as unknown as Record<string, unknown>} listRecord={listV4} entityId={entityId} /> : <MissingVersion version="v4" />}
      {row.v3 ? <VersionDetails version="v3" record={row.v3 as unknown as Record<string, unknown>} listRecord={listV3} entityId={entityId} /> : <MissingVersion version="v3" />}
    </div>
  </section>;
}

/** One name-matched list owns both source trees. The item browser pairs the
 * records for display; selecting one keeps both source records intact. */
export function ListsWorkspace({ v4, v3, entityId, actionsDisabled = false, onRefreshed }: { v4: ConcurList | null; v3: ConcurListV3 | null; entityId: string; actionsDisabled?: boolean; onRefreshed?: () => Promise<unknown> }) {
  const [query, setQuery] = useState('');
  const [generation, setGeneration] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PairedListItem | null>(null);
  const [legacyState, setLegacyState] = useState<{ key: string; items?: ConcurListItemV3[]; error?: string }>({ key: '' });
  const [legacyRetry, setLegacyRetry] = useState(0);
  const legacyKey = `${v3?.ID ?? ''}:${generation}:${legacyRetry}`;
  const resolvedList = useListResource(recordData(v3), entityId, generation);
  const currentList = recordData(v4);

  useEffect(() => {
    if (!v3) return;
    let cancelled = false;
    setLegacyState({ key: legacyKey });
    void getListItemsV3(v3.ID).then(snapshot => {
      if (!cancelled) setLegacyState({ key: legacyKey, items: snapshot.items });
    }).catch(error => {
      if (!cancelled) setLegacyState({ key: legacyKey, error: error instanceof Error ? error.message : String(error) });
    });
    return () => { cancelled = true; };
  }, [v3, legacyKey]);

  const refresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    setSelected(null);
    try {
      const results = await Promise.allSettled([
        ...(v4 ? [refreshListItems(v4.id)] : []),
        ...(v3 ? [refreshListItemsV3(v3.ID)] : []),
      ]);
      const errors = results.flatMap(result => result.status === 'rejected' ? [String(result.reason)] : result.value.truncated || result.value.complete === false ? [`${result.value.listId}: the snapshot is incomplete. Retry retrieval.`] : []);
      if (errors.length) setRefreshError(errors.join('; '));
      setGeneration(value => value + 1);
      await onRefreshed?.();
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  };

  const name = v4 ? listName(v4) : v3?.Name ?? v3?.ID ?? 'List';
  const legacy = legacyState.key === legacyKey ? legacyState : null;
  return <section aria-label="Selected list workspace" className="min-w-0 overflow-hidden rounded-lg border bg-card">
    <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
      <h2 className="min-w-0 break-words text-lg font-semibold">{name}</h2>
      <Button type="button" variant="ghost" size="icon" loading={refreshing} disabled={actionsDisabled} aria-label={`Refresh ${name} data`} title="Retrieve both versions' complete item snapshots again" onClick={() => void refresh()}>{!refreshing ? <ArrowClockwiseIcon size={16} /> : null}</Button>
      <p className="ml-auto text-xs text-muted-foreground">{v4?.category?.type ? `Category: ${v4.category.type}` : 'v3 only'}{v4?.levelCount ? ` · Levels: ${v4.levelCount}` : ''}</p>
    </header>
    <div className="p-4">
      {refreshing ? <p role="status" className="mb-3 text-xs text-muted-foreground">Retrieving complete item snapshots from Concur…</p> : null}
      {refreshError ? <p role="alert" className="mb-3 rounded-md border border-destructive/30 p-3 text-xs text-destructive">Retrieval failed: {refreshError}</p> : null}
      <h3 className="mb-2 text-sm font-semibold">List metadata ({name})</h3>
      <ResourceFeedback {...resolvedList} />
      <ListMetadataComparison v4={currentList} v3={resolvedList.data} />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
        <h3 className="text-sm font-semibold">List items ({name})</h3>
        <Input aria-label="Filter items by name, code or ID" placeholder="Filter item name, code or ID…" value={query} onChange={event => setQuery(event.target.value)} className="h-8 max-w-sm text-xs" />
      </div>
      {legacy?.error ? <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 text-xs text-destructive">Could not load v3 items: {legacy.error}<Button type="button" size="sm" variant="outline" onClick={() => setLegacyRetry(value => value + 1)}>Retry v3 items</Button></div> : null}
      {/* The browser mounts as soon as either version is known and merges the
          v3 snapshot in when it lands, so opening a big lazy v4 list never
          waits on the legacy request. */}
      <div className="mt-3">
        {!v4 && !v3 ? <p className="py-3 text-xs text-muted-foreground">No item data available.</p> : <>
          {v3 && !legacy?.items && !legacy?.error ? <p role="status" className="mb-2 text-xs text-muted-foreground">Loading v3 items…</p> : null}
          <ListItemsTree key={`${v4?.id ?? ''}:${v3?.ID ?? ''}:${generation}`} listId={v4?.id ?? null} v3Items={legacy?.items ?? []} filterQuery={query} selected={selected} onSelect={setSelected} />
        </>}
      </div>
      {selected ? <SelectedItemDetails key={`${entityId}:${selected.key}`} row={selected} entityId={entityId} listV3={resolvedList.data} listV4={currentList} onClose={() => setSelected(null)} /> : <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">Select an item to compare its v4 and v3 data.</p>}
      <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">List technical information</summary><div className="grid gap-3 md:grid-cols-2"><TechnicalRecord record={currentList} /><TechnicalRecord record={resolvedList.data} /></div></details>
    </div>
  </section>;
}