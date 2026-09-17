/**
 * Browser metadata attached to `/auth/token` so the local backend can audit
 * which client first contacted each Concur entity in this process.
 */

export type NavigatorLike = {
  userAgent?: string;
  language?: string;
  languages?: readonly string[];
  platform?: string;
  userAgentData?: {
    brands?: Array<{ brand: string; version: string }>;
    mobile?: boolean;
    platform?: string;
  };
};

/** Build X-Client-* headers from the current browser navigator. */
export function clientInfoHeaders(nav: NavigatorLike = typeof navigator !== 'undefined' ? navigator : {}): Record<string, string> {
  const headers: Record<string, string> = {};
  if (nav.userAgent) headers['X-Client-User-Agent'] = nav.userAgent;
  if (nav.language) headers['X-Client-Language'] = nav.language;
  if (nav.languages?.length) headers['X-Client-Languages'] = nav.languages.join(',');
  if (nav.platform) headers['X-Client-Platform'] = nav.platform;
  const uaData = nav.userAgentData;
  if (uaData) {
    headers['X-Client-Ua-Data'] = JSON.stringify({
      brands: uaData.brands,
      mobile: uaData.mobile,
      platform: uaData.platform,
    });
  }
  return headers;
}
