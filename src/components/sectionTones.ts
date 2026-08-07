/**
 * Shared soft-tint palette for collapsible detail sections (profile details,
 * forms hierarchy, …). Each tone tints the section border, the header
 * background + title, and the body's top divider. Dark-mode aware.
 */
export type SectionTone = 'blue' | 'emerald' | 'violet' | 'amber' | 'sky' | 'rose' | 'indigo';

export const sectionTones: Record<SectionTone, { section: string; header: string; title: string; body: string }> = {
  blue: {
    section: 'border-blue-200 dark:border-blue-900/60',
    header: 'bg-blue-50 hover:bg-blue-100/70 dark:bg-blue-950/40 dark:hover:bg-blue-950/70',
    title: 'text-blue-700 dark:text-blue-300',
    body: 'border-blue-100 dark:border-blue-900/40',
  },
  emerald: {
    section: 'border-emerald-200 dark:border-emerald-900/60',
    header: 'bg-emerald-50 hover:bg-emerald-100/70 dark:bg-emerald-950/40 dark:hover:bg-emerald-950/70',
    title: 'text-emerald-700 dark:text-emerald-300',
    body: 'border-emerald-100 dark:border-emerald-900/40',
  },
  violet: {
    section: 'border-violet-200 dark:border-violet-900/60',
    header: 'bg-violet-50 hover:bg-violet-100/70 dark:bg-violet-950/40 dark:hover:bg-violet-950/70',
    title: 'text-violet-700 dark:text-violet-300',
    body: 'border-violet-100 dark:border-violet-900/40',
  },
  amber: {
    section: 'border-amber-200 dark:border-amber-900/60',
    header: 'bg-amber-50 hover:bg-amber-100/70 dark:bg-amber-950/40 dark:hover:bg-amber-950/70',
    title: 'text-amber-700 dark:text-amber-300',
    body: 'border-amber-100 dark:border-amber-900/40',
  },
  sky: {
    section: 'border-sky-200 dark:border-sky-900/60',
    header: 'bg-sky-50 hover:bg-sky-100/70 dark:bg-sky-950/40 dark:hover:bg-sky-950/70',
    title: 'text-sky-700 dark:text-sky-300',
    body: 'border-sky-100 dark:border-sky-900/40',
  },
  rose: {
    section: 'border-rose-200 dark:border-rose-900/60',
    header: 'bg-rose-50 hover:bg-rose-100/70 dark:bg-rose-950/40 dark:hover:bg-rose-950/70',
    title: 'text-rose-700 dark:text-rose-300',
    body: 'border-rose-100 dark:border-rose-900/40',
  },
  indigo: {
    section: 'border-indigo-200 dark:border-indigo-900/60',
    header: 'bg-indigo-50 hover:bg-indigo-100/70 dark:bg-indigo-950/40 dark:hover:bg-indigo-950/70',
    title: 'text-indigo-700 dark:text-indigo-300',
    body: 'border-indigo-100 dark:border-indigo-900/40',
  },
};

/** Cycle through the palette (for repeated sibling sections like form types). */
export const sectionToneCycle: SectionTone[] = ['blue', 'emerald', 'violet', 'amber', 'sky', 'rose', 'indigo'];
