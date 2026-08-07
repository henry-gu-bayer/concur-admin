import { ReactNode } from 'react';

interface TabItem {
  id: string;
  label: string;
  /** Optional semantic color: leading dot, active text color, active underline. */
  dotClass?: string;
  activeClass?: string;
  underlineClass?: string;
}

interface TabsProps {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
}

export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div role="tablist" className="flex items-center gap-1 border-b">
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.id)}
            className={`relative px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-t-md ${
              isActive ? (t.activeClass ?? 'text-foreground') : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.dotClass && <span className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${t.dotClass}`} aria-hidden="true" />}
            {t.label}
            {isActive && <span className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full ${t.underlineClass ?? 'bg-primary'}`} aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ children }: { children: ReactNode }) {
  return (
    <div role="tabpanel" className="pt-4 animate-fade-in">
      {children}
    </div>
  );
}
