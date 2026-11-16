import { Button } from './ui/Button';
import { navigateToCategory, requestReportSearch } from '../state/viewNavigation';

/**
 * Jump from a user profile to that user's expense reports.
 *
 * Queue the search first so Reports can start it as soon as it becomes visible.
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
