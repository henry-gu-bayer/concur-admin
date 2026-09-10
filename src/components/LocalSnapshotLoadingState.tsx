export function LocalSnapshotLoadingState({ profileName }: { profileName: string }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-12 text-center" role="status" aria-live="polite" aria-label={`Loading local ${profileName} snapshot`}>
      <div className="max-w-sm">
        <svg className="mx-auto h-7 w-7 animate-spin text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="9" className="opacity-25" />
          <path d="M21 12a9 9 0 0 0-9-9" className="opacity-75" />
        </svg>
        <h2 className="mt-3 text-sm font-semibold text-foreground">Loading local {profileName} snapshot…</h2>
        <p className="mt-1 text-xs text-muted-foreground">Checking the saved snapshot and loading the first active profiles. This can take a moment for large data sets.</p>
      </div>
    </div>
  );
}
