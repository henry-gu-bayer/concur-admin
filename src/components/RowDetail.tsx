import { useEffect, useState } from 'react';
import { ConfigItem } from '../types';

function SkeletonBlock({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-md bg-muted bg-gradient-to-r from-muted via-muted-foreground/10 to-muted bg-[length:200%_100%] animate-shimmer ${className}`}
      aria-hidden="true"
    />
  );
}

/**
 * Generic inline detail panel for any configuration object. Renders the
 * item's `fields` as a definition grid and `children` as a nested table —
 * the same anatomy for every category, fed by the descriptor's data.
 */
export function RowDetail({ item }: { item: ConfigItem }) {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => setLoading(false), 280);
    return () => clearTimeout(t);
  }, [item.id]);

  return (
    <div className="border-t bg-muted/40 px-4 py-4 sm:px-6 animate-fade-in">
      {loading ? (
        <div className="space-y-2" aria-busy="true" aria-label={`Loading details for ${item.name}`}>
          <SkeletonBlock className="h-4 w-2/3" />
          <SkeletonBlock className="h-4 w-1/2" />
          <SkeletonBlock className="h-20 w-full" />
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
            {item.fields.map((f) => (
              <div key={f.label} className="min-w-0">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{f.label}</dt>
                <dd className="mt-1 break-words text-sm font-medium">{f.value}</dd>
              </div>
            ))}
          </dl>

          {item.children && (
            <div className="mt-5">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Contained items
              </h4>
              <div className="overflow-x-auto rounded-md border bg-card">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      {item.children.columns.map((c) => (
                        <th key={c} scope="col" className="px-3 py-2 font-medium">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {item.children.rows.map((row, i) => (
                      <tr key={i} className="border-b last:border-0">
                        {row.map((cell, j) => (
                          <td key={j} className={`px-3 py-2 ${j === 0 ? 'font-mono text-xs' : ''}`}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
