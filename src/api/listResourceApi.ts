import { concurGet } from './concurFetch';

/** Resource URLs are data, not trusted destinations. Only list resources may
 * be dereferenced through the existing authenticated, logged Concur proxy. */
export async function getListResource(uri: string, entityId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const url = new URL(uri, 'https://us.api.concursolutions.com');
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || !/^(?:[a-z0-9-]+\.)*api\.concursolutions\.com$/i.test(url.hostname)
    || !/^\/api\/v3\.0\/common\/(?:lists|listitems)\/[^/]+\/?$/.test(url.pathname)) {
    throw new Error('The detail URL is not a Concur v3 list or list-item resource.');
  }
  const data = await concurGet<unknown>(`${url.pathname}${url.search}`, { headers: { 'X-Concur-Entity': entityId }, signal });
  if (!data || typeof data !== 'object') throw new Error('Concur returned an invalid list detail response.');
  return Array.isArray(data) ? { Items: data } : data as Record<string, unknown>;
}
