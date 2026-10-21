import { Button } from './ui/Button';
import { navigateToCategory, requestReportSearch } from '../state/viewNavigation';

/**
 * Jump from a user profile to that user's expense reports.
 *
 * The search is queued before the category switch: the Reports view mounts in
 * the same commit as the switch and claims the queue on mount, which is what
 * makes the destination arrive already searching instead of on a blank form.
 */
export function UserReportsButton({ loginId, disabled = false }: { loginId?: string | null; disabled?: boolean }) {
  const value = loginId?.trim();
  if (!value) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={disabled}
      aria-label={`Search expense reports for ${value}`}
      title={`Search expense reports for ${value}`}
      onClick={() => {
        requestReportSearch(value);
        navigateToCategory('reports');
      }}
    >
      Expense reports
    </Button>
  );
}