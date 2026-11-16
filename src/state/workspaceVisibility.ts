import { createContext } from 'react';

/** Hidden workspaces keep processing requests without owning the active UI. */
export const WorkspaceVisible = createContext(true);

/** Dialogs can offer Home while their backdrop covers the sidebar. */
export const ReturnHome = createContext<(() => void) | null>(null);
