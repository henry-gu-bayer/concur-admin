import type { TravelUserProfile } from '../types';
import { concurGet } from './concurFetch';

const TRAVEL_USER_PATH = '/travel/v4/Users';

/** Travel User v4 profile client. Calls go through the same authenticated Concur proxy. */
export async function getTravelUser(userId: string): Promise<TravelUserProfile> {
  const id = userId.trim();
  if (!id) throw new Error('User ID is required');
  return concurGet<TravelUserProfile>(`${TRAVEL_USER_PATH}/${encodeURIComponent(id)}`);
}
