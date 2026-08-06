import { SpendUserProfile } from '../types';
import { concurGet } from './concurFetch';

const SPEND_USER_PATH = '/profile/spend/v4.1/Users';

/** Spend User v4.1 live API client. Calls go through the same authenticated Concur proxy. */
export async function getSpendUser(userId: string): Promise<SpendUserProfile> {
  const id = userId.trim();
  if (!id) throw new Error('User ID is required');
  return concurGet<SpendUserProfile>(`${SPEND_USER_PATH}/${encodeURIComponent(id)}`);
}
