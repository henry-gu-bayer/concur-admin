import { useEffect, useState } from 'react';
import { ArrowClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowClockwise';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import type { ConcurList, ConcurListItem, ConcurListItemV3, ConcurListV3 } from '../types';
import { refreshListItems } from '../api/listItemsApi';
import { getListItemsV3, refreshListItemsV3 } from '../api/listItemsV3Api';
import { listName } from '../api/listsApi';
import { ItemTree } from './ItemTree';
import { ItemTreeV3 } from './ItemTreeV3';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { ListMetadataComparison, RecordFieldTable, ResourceFeedback, TechnicalRecord, recordData, useListResource } from './ListRecordFields';

type SelectedItem = { version: 'v4'; item: ConcurListItem } | { version: 'v3'; item: ConcurListItemV3 };

function SelectedItemDetails({ selected, entityId, listV3, listV4, onClose }: { selected: SelectedItem; entityId: string; listV3: Record<string, unknown> | null; listV4: Record<string, unknown> | null; onClose: () => void }) {
  const resolved = useListResource(recordData(selected.item), entityId);
  const name = selected.version === 'v3' ? selected.item.Name ?? selected.item.ID : selected.item.value ?? selected.item.id;
  return <section aria-label={`${selected.version} item details`} className="mt-4 overflow-hidden rounded-md border bg-card">
    <header className="flex items-center justify-between gap-2 border-b bg-muted/20 px-3 py-2.5"><h3 className="min-w-0 break-words text-sm font-semibold">{selected.version} item details — {name}</h3><Button type="button" size="icon" variant="ghost" aria-label="Close item details" onClick={onClose}><XIcon size={16} /></Button></header>
    <div className="p-3">
      <ResourceFeedback {...resolved} />
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="min-w-0"><h4 className="mb-2 text-xs font-semibold">Item information ({selected.version})</h4><RecordFieldTable label="Complete item fields" record={resolved.data} /></div>
        <div className="min-w-0"><h4 className="mb-2 text-xs font-semibold">Related list information ({selected.version})</h4><RecordFieldTable label="Related list fields" record={selected.version === 'v3' ? listV3 : listV4} /></div>
      </div>
      <TechnicalRecord record={resolved.data} />
    </div>
  </section>;
}

/** One name-matched list owns both source trees. The items themselves are
 * never name-matched: selecting a record keeps its API version and ID intact. */
export function ListsWorkspace({ v4, v3, entityId, actionsDisabled = false, onRefreshed }: { v4: ConcurList | null; v3: ConcurListV3 | null; entityId: string; actionsDisabled?: boolean; onRefreshed?: () => Promise<unknown> }) {
  const [query, setQuery] = useState('');
  const [generation, setGeneration] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedItem | null>(null);
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
        <Input aria-label="Filter both versions' items" placeholder="Filter item name, code or ID…" value={query} onChange={event => setQuery(event.target.value)} className="h-8 max-w-sm text-xs" />
      </div>
      <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-2">
        <section aria-label="v4 list items" className="min-w-0"><h4 className="mb-2 text-sm font-semibold">v4 items</h4>{v4 ? <ItemTree key={`${v4.id}:${generation}`} listId={v4.id} compact filterQuery={query} selectedId={selected?.version === 'v4' ? selected.item.id : undefined} onSelect={item => setSelected({ version: 'v4', item })} /> : <p className="py-3 text-xs text-muted-foreground">No v4 data available.</p>}</section>
        <section aria-label="v3 list items" className="min-w-0"><h4 className="mb-2 text-sm font-semibold">v3 items{legacy?.items ? ` (${legacy.items.length})` : ''}</h4>{!v3 ? <p className="py-3 text-xs text-muted-foreground">No v3 data available.</p> : legacy?.error ? <div role="alert" className="text-xs text-destructive">Could not load v3 items: {legacy.error}<Button type="button" size="sm" variant="outline" onClick={() => setLegacyRetry(value => value + 1)}>Retry v3 items</Button></div> : !legacy?.items ? <p role="status" className="py-3 text-xs text-muted-foreground">Loading v3 items…</p> : <ItemTreeV3 key={`${v3.ID}:${generation}`} items={legacy.items} compact filterQuery={query} selectedId={selected?.version === 'v3' ? selected.item.ID : undefined} onSelect={item => setSelected({ version: 'v3', item })} />}</section>
      </div>
      {v4 ? <p className="mt-2 text-xs text-muted-foreground">v4 children load on expansion. Filtering covers loaded v4 items and saved v3 items; use Retrieve All List Items for complete local search.</p> : null}
      {selected ? <SelectedItemDetails key={`${entityId}:${selected.version}:${selected.version === 'v3' ? selected.item.ID : selected.item.id}`} selected={selected} entityId={entityId} listV3={resolvedList.data} listV4={currentList} onClose={() => setSelected(null)} /> : <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">Select an item from either version to inspect all its fields.</p>}
      <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">List technical information</summary><div className="grid gap-3 md:grid-cols-2"><TechnicalRecord record={currentList} /><TechnicalRecord record={resolvedList.data} /></div></details>
    </div>
  </section>;
}
