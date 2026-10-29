import { Fragment, useEffect, useMemo, useState } from 'react';
import { checkSaeFiles, type SaeCheckResponse, type SaeFileResult, type SaeRuleSummary } from '../api/saeCheckApi';
import { getActiveEntityId } from '../entities/entityStore';
import { saeCheckViewSessions } from './saeCheckSessionCache';
import { EmptyPanel, ErrorPanel, RetrievalProgress, useElapsedMs } from './ui/AsyncState';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Input, Select } from './ui/Input';

type SeverityFilter = 'all' | 'error' | 'warning';

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

function fileStatus(file: SaeFileResult) {
  if (file.errors > 0) return <Badge tone="destructive" dot>{formatCount(file.errors)} errors</Badge>;
  if (file.warnings > 0) return <Badge tone="warning" dot>Warnings only</Badge>;
  return <Badge tone="success" dot>Passed</Badge>;
}

export function SaeCheckView() {
  const entityId = getActiveEntityId();
  const session = saeCheckViewSessions.get(entityId);
  const [path, setPath] = useState(session?.path ?? '');
  const [result, setResult] = useState<SaeCheckResponse | null>(session?.result ?? null);
  const [selectedFile, setSelectedFile] = useState<string | null>(session?.selectedFile ?? null);
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const elapsedMs = useElapsedMs(running);

  useEffect(() => {
    saeCheckViewSessions.set(entityId, { path, result, selectedFile });
  }, [entityId, path, result, selectedFile]);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const next = await checkSaeFiles(path);
      setResult(next);
      setSelectedFile(next.files.length === 1 ? next.files[0].path : null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRunning(false);
    }
  };

  const totals = useMemo(() => ({
    errors: result?.files.reduce((sum, file) => sum + file.errors, 0) ?? 0,
    warnings: result?.files.reduce((sum, file) => sum + file.warnings, 0) ?? 0,
    crossErrors: result?.crossFile.filter((finding) => finding.severity === 'error').length ?? 0,
  }), [result]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <form
        className="mb-3 flex min-w-0 flex-wrap items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <Input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          aria-label="SAE file or folder path"
          placeholder="SAE file or folder path — blank checks data\integrations\sae"
          className="h-8 min-w-[280px] flex-1 font-mono text-xs"
        />
        <Select value={severity} onChange={(event) => setSeverity(event.target.value as SeverityFilter)} aria-label="Filter findings by severity" className="h-8 w-32 text-xs">
          <option value="all">All findings</option>
          <option value="error">Errors only</option>
          <option value="warning">Warnings only</option>
        </Select>
        <Button type="submit" size="sm" loading={running}>Check</Button>
      </form>

      {running && <RetrievalProgress label="Checking SAE files" detail={path || 'data\\integrations\\sae'} elapsedMs={elapsedMs} />}
      {error && <ErrorPanel title="SAE check failed" message={error} onRetry={() => void run()} />}

      {!error && !result && !running && (
        <EmptyPanel
          title="No SAE files checked yet"
          message="Enter an SAE extract file or a folder of extracts, then choose Check. Every .txt file in a folder is validated against the SAE V3 specification; V2 extracts are detected and checked on their 256 columns."
        />
      )}

      {!error && result && (
        <>
          <p className="mb-2 text-xs text-muted-foreground" aria-live="polite">
            <span className="font-mono">{result.target}</span>
            {' · '}{result.files.length} {result.files.length === 1 ? 'file' : 'files'}
            {' · '}{formatCount(totals.errors + totals.crossErrors)} errors
            {' · '}{formatCount(totals.warnings + result.crossFile.length - totals.crossErrors)} warnings
            {' · checked '}{new Date(result.checkedAt).toLocaleTimeString()}
          </p>

          {result.skipped.length > 0 && (
            <div role="alert" className="mb-3 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs">
              <p className="font-semibold">Skipped files</p>
              <ul className="mt-1 space-y-0.5">
                {result.skipped.map((item) => <li key={item.name}><span className="font-mono">{item.name}</span> — {item.reason}</li>)}
              </ul>
            </div>
          )}

          {result.files.length === 0 ? (
            <EmptyPanel title="No SAE files found" message="The folder contains no .txt extract files." />
          ) : (
            <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card">
              <table className="w-full text-sm" aria-label="SAE file check results">
                <thead className="sticky top-0 z-10 bg-muted">
                  <tr className="border-b text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="w-8 px-2 py-2"><span className="sr-only">Expand</span></th>
                    <th scope="col" className="px-3 py-2">File</th>
                    <th scope="col" className="px-3 py-2">Version</th>
                    <th scope="col" className="px-3 py-2">Batch</th>
                    <th scope="col" className="px-3 py-2 text-right">Rows</th>
                    <th scope="col" className="hidden px-3 py-2 text-right md:table-cell">Reports</th>
                    <th scope="col" className="hidden px-3 py-2 text-right lg:table-cell">Journal total</th>
                    <th scope="col" className="px-3 py-2 text-right">Errors</th>
                    <th scope="col" className="px-3 py-2 text-right">Warnings</th>
                    <th scope="col" className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.files.map((file) => {
                    const expanded = selectedFile === file.path;
                    return (
                      <Fragment key={file.path}>
                        <tr
                          className={`cursor-pointer border-b transition-colors ${expanded ? 'bg-accent/50' : 'hover:bg-accent/30'}`}
                          onClick={() => setSelectedFile(expanded ? null : file.path)}
                        >
                          <td className="px-2 py-2">
                            <button
                              type="button"
                              aria-expanded={expanded}
                              aria-label={`${expanded ? 'Collapse' : 'Expand'} ${file.name}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedFile(expanded ? null : file.path);
                              }}
                              className="flex h-6 w-6 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <svg className={`h-4 w-4 transition-transform ${expanded ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                          </td>
                          <td className="max-w-[360px] truncate px-3 py-2 font-mono text-xs" title={file.path}>{file.name}</td>
                          <td className="px-3 py-2 text-xs">{file.version}</td>
                          <td className="px-3 py-2 font-mono text-xs">{file.batchId ?? '—'}{file.header.batchDate ? ` · ${file.header.batchDate}` : ''}</td>
                          <td className="px-3 py-2 text-right text-xs tabular-nums">{formatCount(file.detailRows)}</td>
                          <td className="hidden px-3 py-2 text-right text-xs tabular-nums md:table-cell">{formatCount(file.reportCount)}</td>
                          <td className="hidden px-3 py-2 text-right font-mono text-xs tabular-nums lg:table-cell">{file.header.journalTotal ?? '—'}</td>
                          <td className={`px-3 py-2 text-right text-xs tabular-nums ${file.errors ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>{formatCount(file.errors)}</td>
                          <td className={`px-3 py-2 text-right text-xs tabular-nums ${file.warnings ? 'text-warning' : 'text-muted-foreground'}`}>{formatCount(file.warnings)}</td>
                          <td className="px-3 py-2">{fileStatus(file)}</td>
                        </tr>
                        {expanded && (
                          <tr className="border-b bg-muted/30">
                            <td colSpan={10} className="px-3 py-3">
                              <FileDetail file={file} severity={severity} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>

              {result.crossFile.length > 0 && (
                <section aria-label="Cross-file findings" className="border-t px-3 py-3">
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Across files</h2>
                  <ul className="space-y-1 text-xs">
                    {result.crossFile
                      .filter((finding) => severity === 'all' || finding.severity === severity)
                      .map((finding, index) => (
                        <li key={`${finding.rule}-${index}`} className="flex flex-wrap items-baseline gap-2">
                          <Badge tone={finding.severity === 'error' ? 'destructive' : 'warning'}>{finding.rule}</Badge>
                          <span>{finding.message}</span>
                          {finding.files.length > 0 && <span className="font-mono text-muted-foreground">{finding.files.join(', ')}</span>}
                        </li>
                      ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FileDetail({ file, severity }: { file: SaeFileResult; severity: SeverityFilter }) {
  const rules = file.rules.filter((rule) => severity === 'all' || (severity === 'error' ? rule.errors > 0 : rule.warnings > 0));
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
        <div><dt className="text-muted-foreground">Header record count</dt><dd className="font-mono">{file.header.recordCount ?? '—'}</dd></div>
        <div><dt className="text-muted-foreground">Header journal total</dt><dd className="font-mono">{file.header.journalTotal ?? '—'}</dd></div>
        <div><dt className="text-muted-foreground">Computed journal total</dt><dd className="font-mono">{file.computedJournalTotal ?? '—'}</dd></div>
        <div><dt className="text-muted-foreground">Size</dt><dd>{formatBytes(file.size)}</dd></div>
      </dl>
      {file.version === 'V2' && (
        <p className="text-xs text-muted-foreground">
          V2 extract (4-field header, 256 columns): checked against SAE V3 columns 1–256. V3-only checks — header batch ID and reserved columns 261–400 — do not apply.
        </p>
      )}
      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">{file.rules.length === 0 ? 'No findings — the file passed every check.' : 'No findings match the severity filter.'}</p>
      ) : (
        <ul aria-label={`Findings for ${file.name}`} className="space-y-1.5">
          {rules.map((rule) => <RuleFindings key={rule.rule} rule={rule} severity={severity} />)}
        </ul>
      )}
    </div>
  );
}

function RuleFindings({ rule, severity }: { rule: SaeRuleSummary; severity: SeverityFilter }) {
  const [open, setOpen] = useState(false);
  const total = rule.errors + rule.warnings;
  const findings = rule.findings.filter((finding) => severity === 'all' || finding.severity === severity);
  const hasLocation = findings.some((finding) => finding.line !== undefined);
  return (
    <li className="overflow-hidden rounded-md border bg-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <Badge tone={rule.errors > 0 ? 'destructive' : 'warning'}>{rule.rule}</Badge>
        <span className="min-w-0 flex-1 truncate font-medium">{rule.title}</span>
        {rule.errors > 0 && <span className="shrink-0 tabular-nums text-destructive">{formatCount(rule.errors)} errors</span>}
        {rule.warnings > 0 && <span className="shrink-0 tabular-nums text-warning">{formatCount(rule.warnings)} warnings</span>}
        <svg className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="border-t">
          {hasLocation ? (
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-xs" aria-label={`${rule.rule} findings`}>
                <thead className="sticky top-0 bg-muted">
                  <tr className="text-left text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-3 py-1.5">Line</th>
                    <th scope="col" className="px-3 py-1.5">Seq</th>
                    <th scope="col" className="px-3 py-1.5">Column</th>
                    <th scope="col" className="px-3 py-1.5">Value</th>
                    <th scope="col" className="px-3 py-1.5">Report ID</th>
                    <th scope="col" className="px-3 py-1.5">Finding</th>
                  </tr>
                </thead>
                <tbody>
                  {findings.map((finding, index) => (
                    <tr key={index} className="border-t align-top">
                      <td className="px-3 py-1.5 font-mono tabular-nums">{finding.line ?? '—'}</td>
                      <td className="px-3 py-1.5 font-mono tabular-nums">{finding.sequence ?? '—'}</td>
                      <td className="px-3 py-1.5">{finding.column ? <><span className="font-mono">{finding.column}</span> {finding.columnName}</> : finding.columnName ?? '—'}</td>
                      <td className="max-w-[200px] break-all px-3 py-1.5 font-mono">{finding.value ?? '—'}</td>
                      <td className="px-3 py-1.5 font-mono">{finding.reportId ?? '—'}</td>
                      <td className="px-3 py-1.5">
                        {finding.severity !== rule.severity && <span className="mr-1 text-warning">[warning]</span>}
                        {finding.message}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ul className="space-y-1 px-3 py-2 text-xs">
              {findings.map((finding, index) => <li key={index}>{finding.message}</li>)}
            </ul>
          )}
          {total > rule.findings.length && (
            <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
              Showing the first {formatCount(rule.findings.length)} of {formatCount(total)} occurrences.
            </p>
          )}
        </div>
      )}
    </li>
  );
}
