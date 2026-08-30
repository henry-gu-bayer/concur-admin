interface RequestLike {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
}

interface ResponseLike {
  writeHead: (code: number, headers: Record<string, string>) => void;
  end: (body?: string) => void;
}

export interface RoutePolicy {
  methods: string[];
  sameOrigin?: boolean;
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

/** Method contracts and same-origin checks for local endpoints that mutate snapshots. */
export function enforceRequestPolicy(req: RequestLike, res: ResponseLike, policy: RoutePolicy): boolean {
  const method = (req.method ?? 'GET').toUpperCase();
  if (!policy.methods.includes(method)) {
    res.writeHead(405, {
      Allow: policy.methods.join(', '),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({ error: `Method ${method} not allowed` }));
    return false;
  }

  if (policy.sameOrigin) {
    const origin = headerValue(req.headers.origin);
    const host = headerValue(req.headers.host);
    if (origin) {
      let originHost = '';
      try {
        originHost = new URL(origin).host.toLowerCase();
      } catch {
        /* Invalid origins fail closed. */
      }
      if (!host || originHost !== host.toLowerCase()) {
        res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'Cross-origin snapshot mutation denied' }));
        return false;
      }
    }
  }
  return true;
}

/** Returns null for the generic Concur proxy, whose method must be forwarded unchanged. */
export function localRoutePolicy(rawUrl: string): RoutePolicy | null {
  const pathname = rawUrl.split('?')[0];
  if (pathname === '/auth/token' || pathname.startsWith('/api/local/')) {
    const isMutation = pathname.endsWith('/refresh')
      || pathname === '/api/local/list-items/bulk'
      || pathname.endsWith('/query')
      || pathname.endsWith('/export')
      || pathname.startsWith('/api/local/expense-groups/user/');
    return isMutation ? { methods: ['POST'], sameOrigin: true } : { methods: ['GET'] };
  }
  return null;
}
