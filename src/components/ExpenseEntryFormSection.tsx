import { useEffect, useMemo, useState } from 'react';
import { fetchExpenseFormFields } from '../api/expenseFormFieldsApi';
import type { ReportFormField } from '../api/reportFormFieldsApi';
import type { ExpenseEntry, ExpenseV4 } from '../types';
import { ConfiguredFormFields } from './ConfiguredFormFields';
import { expenseFormValues } from './expenseFormValues';
import { Button } from './ui/Button';

export function ExpenseEntryFormSection({ reportId, entry, expense, entityId }: { reportId: string; entry: ExpenseEntry; expense: ExpenseV4 | null; entityId: string }) {
  const [fields, setFields] = useState<ReportFormField[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const expenseId = entry.ExpenseID?.trim();
  const rows = useMemo(() => fields ? expenseFormValues(fields, entry, expense) : [], [fields, entry, expense]);

  useEffect(() => {
    if (!expenseId) return;
    const controller = new AbortController();
    setFields(null);
    setError(null);
    void fetchExpenseFormFields(reportId, expenseId, entityId, controller.signal)
      .then(result => { if (!controller.signal.aborted) setFields(result); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not retrieve expense form fields.'); });
    return () => controller.abort();
  }, [reportId, expenseId, entityId, retry]);

  return <section aria-label="Expense entry form" className="rounded-md border bg-card">
    <div className="border-b px-3 py-2.5"><h4 className="text-sm font-semibold">Expense entry</h4></div>
    {!expenseId ? <p className="p-4 text-xs text-muted-foreground">This entry has no expense ID for retrieving its form.</p>
      : error ? <div className="flex flex-wrap items-center gap-2 p-3 text-xs text-destructive" role="alert">Could not retrieve the expense form: {error}<Button size="sm" variant="outline" onClick={() => setRetry(value => value + 1)}>Retry</Button></div>
        : !fields ? <p role="status" className="p-4 text-xs text-muted-foreground">Retrieving expense form…</p>
          : !rows.length ? <p className="p-4 text-xs text-muted-foreground">No configured expense fields were returned.</p>
            : <ConfiguredFormFields key={`${reportId}-${expenseId}-${entityId}`} rows={rows} entityId={entityId} />}
  </section>;
}
