import { describe, expect, it, vi } from 'vitest';
import { enforceRequestPolicy, localRoutePolicy } from './httpSafety';

function response() {
  return { writeHead: vi.fn(), end: vi.fn() };
}

describe('local endpoint request safety', () => {
  it('makes refresh endpoints POST-only', () => {
    expect(localRoutePolicy('/api/local/locations/refresh?country=CN')).toEqual({ methods: ['POST'], sameOrigin: true });
    const res = response();
    expect(enforceRequestPolicy({ method: 'GET', headers: {} }, res, localRoutePolicy('/api/local/locations/refresh')!)).toBe(false);
    expect(res.writeHead).toHaveBeenCalledWith(405, expect.objectContaining({ Allow: 'POST' }));
  });

  it('rejects a cross-origin snapshot mutation', () => {
    const res = response();
    expect(enforceRequestPolicy({ method: 'POST', headers: { host: '127.0.0.1:5566', origin: 'https://attacker.example' } }, res, { methods: ['POST'], sameOrigin: true })).toBe(false);
    expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
  });

  it('allows same-origin browser requests and origin-less CLI requests', () => {
    expect(enforceRequestPolicy({ method: 'POST', headers: { host: '127.0.0.1:5566', origin: 'http://127.0.0.1:5566' } }, response(), { methods: ['POST'], sameOrigin: true })).toBe(true);
    expect(enforceRequestPolicy({ method: 'POST', headers: { host: '127.0.0.1:5566' } }, response(), { methods: ['POST'], sameOrigin: true })).toBe(true);
  });
});
