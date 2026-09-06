import { useEffect, useState } from 'react';
import { getLocalActiveUsersByIds } from '../api/activeUsersApi';
import { getUserProfile } from '../api/identityApi';
import type { IdentityUserSummary } from '../types';
import { Badge } from './ui/Badge';

export interface UserReferenceResolution {
  id: string;
  profile: IdentityUserSummary | null;
  source: 'local' | 'identity-api' | 'unavailable';
  error?: string;
}

export function useResolvedUserReferences(ids: Array<string | undefined>, generation?: string): Map<string, UserReferenceResolution> {
  const uniqueIds = [...new Set(ids.map((id) => id?.trim()).filter((id): id is string => Boolean(id)))];
  const idsKey = uniqueIds.join('\u0000');
  const queryKey = `${generation ?? 'current'}\u0000${idsKey}`;
  const [state, setState] = useState<{ key: string; references: Map<string, UserReferenceResolution> }>({ key: '', references: new Map() });

  useEffect(() => {
    let current = true;
    if (!uniqueIds.length) {
      setState({ key: queryKey, references: new Map() });
      return () => { current = false; };
    }

    setState({ key: queryKey, references: new Map() });
    void (async () => {
      let localUsers: IdentityUserSummary[] = [];
      try {
        localUsers = (await getLocalActiveUsersByIds(uniqueIds, generation)).users;
      } catch {
        // A local snapshot read failure must not prevent the live Identity fallback.
      }
      if (!current) return;
      const resolved = new Map<string, UserReferenceResolution>();
      for (const profile of localUsers) resolved.set(profile.id, { id: profile.id, profile, source: 'local' });
      const missing = uniqueIds.filter((id) => !resolved.has(id));
      const live = await Promise.allSettled(missing.map((id) => getUserProfile(id)));
      live.forEach((result, index) => {
        const id = missing[index];
        if (result.status === 'fulfilled') resolved.set(id, { id, profile: result.value, source: 'identity-api' });
        else resolved.set(id, { id, profile: null, source: 'unavailable', error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
      });
      if (current) setState({ key: queryKey, references: resolved });
    })();

    return () => { current = false; };
  }, [generation, idsKey, queryKey]);

  return state.key === queryKey ? state.references : new Map();
}

export function UserReferenceDetails({
  label,
  userId,
  resolution,
  primary = false,
}: {
  label: string;
  userId?: string;
  resolution?: UserReferenceResolution;
  primary?: boolean;
}) {
  if (!userId) return null;
  const profile = resolution?.profile;
  const name = profile ? displayName(profile) : undefined;
  const loading = !resolution;
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-x-3 border-b border-border/60 py-2 last:border-b-0">
      <span className="pt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="min-w-0 rounded-md border border-border/70 bg-muted/15 px-2.5 py-2">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <span className="min-w-0 break-words text-xs font-semibold text-foreground">
            {name ?? (loading ? 'Resolving user…' : 'User details unavailable')}
          </span>
          {primary ? <Badge tone="muted">Primary</Badge> : null}
        </div>
        {profile?.userName ? (
          <p className="mt-1 min-w-0 break-all text-[11px] text-foreground">
            <span className="mr-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Login ID</span>
            <span className="font-mono">{profile.userName}</span>
          </p>
        ) : null}
        <p className="mt-1 min-w-0 break-all text-[10px] text-muted-foreground">
          <span className="mr-1.5 font-medium uppercase tracking-wide">UUID</span>
          <span className="font-mono">{userId}</span>
        </p>
        {resolution?.source === 'identity-api' ? <p className="mt-1 text-[10px] text-muted-foreground">Resolved from Identity API</p> : null}
      </div>
    </div>
  );
}

function displayName(user: IdentityUserSummary): string {
  return user.preferredName ?? user.displayName ?? user.name?.formatted ?? ([user.name?.givenName, user.name?.familyName].filter(Boolean).join(' ') || user.userName || 'Unknown user');
}
