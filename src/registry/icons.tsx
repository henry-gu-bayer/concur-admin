import { ReactNode } from 'react';

/** Single stroke-style icon set (1.8 stroke, 24 viewBox) for category nav. */

const s = { stroke: 'currentColor', strokeWidth: 1.8, fill: 'none' } as const;

export const icons: Record<string, ReactNode> = {
  lists: (
    <svg viewBox="0 0 24 24" {...s} aria-hidden="true">
      <path d="M8 6h13M8 12h13M8 18h13" strokeLinecap="round" />
      <circle cx="3.5" cy="6" r="0.5" fill="currentColor" />
      <circle cx="3.5" cy="12" r="0.5" fill="currentColor" />
      <circle cx="3.5" cy="18" r="0.5" fill="currentColor" />
    </svg>
  ),
  'expense-groups': (
    <svg viewBox="0 0 24 24" {...s} aria-hidden="true">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" strokeLinecap="round" />
      <circle cx="17.5" cy="9" r="2.5" />
      <path d="M16 15.2c2.6.3 4.6 1.7 5.3 4.3" strokeLinecap="round" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" {...s} aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c.9-3.4 3.7-5.2 7-5.2s6.1 1.8 7 5.2" strokeLinecap="round" />
      <path d="m18 4.5 1.2 1.2 2.3-2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  'expense-policies': (
    <svg viewBox="0 0 24 24" {...s} aria-hidden="true">
      <path d="M12 3 4 6v5c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V6l-8-3Z" strokeLinejoin="round" />
      <path d="m9 11.5 2.2 2.2L15.5 9.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  'expense-types': (
    <svg viewBox="0 0 24 24" {...s} aria-hidden="true">
      <path d="M20.6 13.4 12 22 2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8Z" strokeLinejoin="round" />
      <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  ),
  'payment-types': (
    <svg viewBox="0 0 24 24" {...s} aria-hidden="true">
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M2.5 9.5h19" />
      <path d="M6 14.5h4" strokeLinecap="round" />
    </svg>
  ),
  'attendee-types': (
    <svg viewBox="0 0 24 24" {...s} aria-hidden="true">
      <circle cx="8" cy="9" r="3" />
      <circle cx="16" cy="9" r="3" />
      <path d="M3 20c.6-2.8 2.6-4.5 5-4.5s4.4 1.7 5 4.5M13.5 15.7c.5-.2 1.1-.3 2.5-.3 2.2 0 4.2 1.6 4.8 4.1" strokeLinecap="round" />
    </svg>
  ),
  forms: (
    <svg viewBox="0 0 24 24" {...s} aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" strokeLinecap="round" />
    </svg>
  ),
  allocations: (
    <svg viewBox="0 0 24 24" {...s} aria-hidden="true">
      <path d="M12 3v9l7 6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  ),
};
