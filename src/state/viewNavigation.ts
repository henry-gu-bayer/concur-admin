/**
 * Cross-view navigation for the category shell.
 *
 * `App` owns the active category. A view that needs to send the user somewhere else (for
 * example, a user profile → that user's expense reports) publishes a request
 * here and `App` switches categories. Payloads destined for the target view
 * sit in a one-shot slot that the destination consumes when it becomes visible, so
 * returning to that view later does not replay the request.
 */

export interface CategoryNavigationRequest {
  categoryId: string;
  /** Monotonic id: repeated requests for the same category still notify. */
  seq: number;
}

export interface ReportSearchRequest {
  loginId: string;
}

export interface UserProfileRequest {
  entityId: string;
  userId?: string;
  loginId?: string;
  displayName?: string;
}

let categoryRequest: CategoryNavigationRequest | null = null;
let requestSeq = 0;
let pendingReportSearch: ReportSearchRequest | null = null;
let pendingUserProfile: UserProfileRequest | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function subscribeViewNavigation(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCategoryNavigationRequest(): CategoryNavigationRequest | null {
  return categoryRequest;
}

export function navigateToCategory(categoryId: string): void {
  categoryRequest = { categoryId, seq: (requestSeq += 1) };
  notify();
}

/** Queue a report search for the Expense Reports view. */
export function requestReportSearch(loginId: string): void {
  pendingReportSearch = { loginId: loginId.trim() };
}

/**
 * Read the queued search without claiming it. React may call useState
 * initializers more than once (StrictMode), so reading must stay side-effect
 * free; the consuming call happens from an effect instead.
 */
export function peekReportSearch(): ReportSearchRequest | null {
  return pendingReportSearch;
}

/** Claim the queued search when Reports becomes visible. */
export function takeReportSearch(): ReportSearchRequest | null {
  const request = pendingReportSearch;
  pendingReportSearch = null;
  return request;
}

/** Open Identity with the report owner's identifiers, not a name search. */
export function openUserProfile(request: UserProfileRequest): void {
  pendingUserProfile = request;
  navigateToCategory('users');
}

/** Claim the request once and only in the source report's entity. */
export function takeUserProfile(entityId: string): UserProfileRequest | null {
  const request = pendingUserProfile;
  pendingUserProfile = null;
  return request?.entityId === entityId ? request : null;
}

/** Reset module state (tests only). */
export function resetViewNavigation(): void {
  categoryRequest = null;
  requestSeq = 0;
  pendingReportSearch = null;
  pendingUserProfile = null;
}
