import { useEffect, useMemo, useState } from 'react';
import { fetchReportFormFields, type ReportFormField } from '../api/reportFormFieldsApi';
import type { ExpenseReport, ExpenseReportV4 } from '../types';
import { reportHeaderFormValues } from './reportHeaderFormValues';
import { ConfiguredFormFields } from './ConfiguredFormFields';
import { Button } from './ui/Button';

/** The report header is read in the report form's configured order. Values
 * come from the selected report, while metadata remains on demand. */
export function ReportHeaderFormSection({ report, reportV4, entityId, policyName }: { report: ExpenseReport; reportV4: ExpenseReportV4 | null; entityId: string; policyName?: string }) {
  const [fields, setFields] = useState<ReportFormField[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const rows = useMemo(() => fields ? reportHeaderFormValues(fields, report, reportV4, policyName) : [], [fields, report, reportV4, policyName]);

  useEffect(() => {
    const controller = new AbortController();
    setFields(null);
    setError(null);
    void fetchReportFormFields(report.ID, entityId, controller.signal)
      .then(result => { if (!controller.signal.aborted) setFields(result); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not retrieve header form fields.'); });
    return () => controller.abort();
  }, [report.ID, entityId, retry]);

  return <section aria-label="Report header form" className="rounded-md border bg-card">
    <div className="border-b px-3 py-2.5"><h3 className="text-sm font-semibold">Report header</h3></div>
    {error ? <div className="flex flex-wrap items-center gap-2 p-3 text-xs text-destructive" role="alert">Could not retrieve the report form: {error}<Button size="sm" variant="outline" onClick={() => setRetry(value => value + 1)}>Retry</Button></div>
      : !fields ? <p role="status" className="p-4 text-sm text-muted-foreground">Retrieving report form…</p>
        : !rows.length ? <p className="p-4 text-sm text-muted-foreground">No configured report header fields were returned.</p>
          : <ConfiguredFormFields key={`${report.ID}-${entityId}`} rows={rows} entityId={entityId} />}
  </section>;
}
