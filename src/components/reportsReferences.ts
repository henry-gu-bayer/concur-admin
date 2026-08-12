import { getExpenseGroups } from '../api/expenseGroupsApi';
import { getFormsSnapshot } from '../api/formsApi';
import { searchLocations } from '../api/locationsApi';
import { ExpenseGroupsSnapshot, FormsSnapshot } from '../types';

/**
 * Reference-name lookups for the Reports view: policy, payment type, form, and
 * location names resolved from data the app has already fetched. Resolution
 * never blocks the UI — failures are cached as empty indexes and lookups then
 * quietly omit the name.
 */
export interface ReportReferences {
  /** Expense policy ID → policy name, from the Expense Group Configurations snapshot. */
  policyNameById: ReadonlyMap<string, string>;
  /** Payment type ID → payment type name, from the same snapshot. */
  paymentTypeNameById: ReadonlyMap<string, string>;
  /** Form ID → form name, from the local Forms & Fields snapshot. */
  formNameById: ReadonlyMap<string, string>;
  /** Locations v3 ID → location name, filled on demand. */
  locationNameById: ReadonlyMap<string, string>;
}

export const EMPTY_REFERENCES: ReportReferences = {
  policyNameById: new Map(),
  paymentTypeNameById: new Map(),
  formNameById: new Map(),
  locationNameById: new Map(),
};

let cache: ReportReferences | null = null;
let pending: Promise<ReportReferences> | null = null;
let locationsPending: Promise<void> | null = null;

/** Current reference state without triggering a load (empty until loaded). */
export function getReportReferences(): ReportReferences {
  return cache ?? EMPTY_REFERENCES;
}

/** Loads (once per page session) the expense-groups and forms snapshots and indexes them. */
export function loadReportReferences(): Promise<ReportReferences> {
  if (cache) return Promise.resolve(cache);
  if (!pending) {
    pending = (async () => {
      const [groupsRes, formsRes] = await Promise.allSettled([getExpenseGroups(), getFormsSnapshot()]);
      const groups = groupsRes.status === 'fulfilled' ? groupsRes.value : null;
      const forms = formsRes.status === 'fulfilled' ? formsRes.value : null;
      cache = {
        policyNameById: indexPolicies(groups),
        paymentTypeNameById: indexPaymentTypes(groups),
        formNameById: indexForms(forms),
        locationNameById: new Map(),
      };
      return cache;
    })();
  }
  return pending;
}

function indexPolicies(snapshot: ExpenseGroupsSnapshot | null): Map<string, string> {
  const index = new Map<string, string>();
  for (const group of snapshot?.groups ?? []) {
    for (const policy of group.Policies ?? []) {
      if (policy.ID && policy.Name) index.set(policy.ID, policy.Name);
    }
  }
  return index;
}

function indexPaymentTypes(snapshot: ExpenseGroupsSnapshot | null): Map<string, string> {
  const index = new Map<string, string>();
  for (const group of snapshot?.groups ?? []) {
    for (const paymentType of group.PaymentTypes ?? []) {
      if (paymentType.ID && paymentType.Name) index.set(paymentType.ID, paymentType.Name);
    }
  }
  return index;
}

function indexForms(snapshot: FormsSnapshot | null): Map<string, string> {
  const index = new Map<string, string>();
  for (const formType of snapshot?.formTypes ?? []) {
    for (const form of formType.forms ?? []) {
      if (form.formId && form.name) index.set(form.formId, form.name);
    }
  }
  return index;
}

/**
 * Fetches every configured location once (Locations v3) and indexes ID → name.
 * Location name lookup by ID is not supported server-side, so this is the only
 * way to resolve entry LocationIDs. Errors resolve silently to an empty index.
 */
export function ensureLocationsLoaded(): Promise<void> {
  if (!locationsPending) {
    locationsPending = (async () => {
      const refs = await loadReportReferences();
      if (refs.locationNameById.size > 0) return;
      const names = refs.locationNameById as Map<string, string>;
      try {
        const result = await searchLocations({});
        for (const location of result.locations) {
          if (location.ID && location.Name) names.set(location.ID, location.Name);
        }
      } catch {
        // No location data available — lookups are simply omitted.
      }
    })();
  }
  return locationsPending;
}
