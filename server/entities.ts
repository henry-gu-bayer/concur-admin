export interface ConcurEntity {
  id: string;
  label: string;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface EntityMetadata {
  id: string;
  label: string;
}

type Environment = Record<string, string | undefined>;

function envKey(id: string): string {
  return id.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function configuredEntity(id: string, env: Environment): ConcurEntity {
  const prefix = `CONCUR_${envKey(id)}_`;
  const entity: ConcurEntity = {
    id,
    label: env[`${prefix}LABEL`]?.trim() || id,
    baseUrl: (env[`${prefix}BASE_URL`] ?? '').replace(/\/+$/, ''),
    clientId: env[`${prefix}CLIENT_ID`] ?? '',
    clientSecret: env[`${prefix}CLIENT_SECRET`] ?? '',
    refreshToken: env[`${prefix}REFRESH_TOKEN`] ?? '',
  };
  if (!entity.baseUrl || !entity.clientId || !entity.clientSecret || !entity.refreshToken) {
    throw new Error(`Concur entity "${id}" is not configured: set ${prefix}{BASE_URL,CLIENT_ID,CLIENT_SECRET,REFRESH_TOKEN}`);
  }
  return entity;
}

export function createEntityRegistry(env: Environment = process.env): {
  defaultId: string;
  list: () => EntityMetadata[];
  require: (id?: string | null) => ConcurEntity;
} {
  const configured = env.CONCUR_ENTITIES;
  const ids = configured === undefined
    ? ['us-uat']
    : configured.split(',').map((id) => id.trim());

  if (ids.some((id) => !id)) throw new Error('CONCUR_ENTITIES contains an empty entity ID');
  if (new Set(ids).size !== ids.length) throw new Error('CONCUR_ENTITIES contains duplicate entity IDs');

  const entities = new Map<string, ConcurEntity>();
  const incomplete = new Map<string, Error>();
  for (const id of ids) {
    if (configured === undefined) {
      const legacy: ConcurEntity = {
        id,
        label: env.CONCUR_US_UAT_LABEL?.trim() || id,
        baseUrl: (env.BASE_URL ?? '').replace(/\/+$/, ''),
        clientId: env.CLIENT_ID ?? '',
        clientSecret: env.CLIENT_SECRET ?? '',
        refreshToken: env.REFRESH_TOKEN ?? '',
      };
      if (!legacy.baseUrl || !legacy.clientId || !legacy.clientSecret || !legacy.refreshToken) {
        throw new Error('Default Concur entity "us-uat" is not configured: set CLIENT_ID, CLIENT_SECRET, BASE_URL, REFRESH_TOKEN');
      }
      entities.set(id, legacy);
    } else {
      try {
        entities.set(id, configuredEntity(id, env));
      } catch (error) {
        incomplete.set(id, error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  if (!entities.size) throw incomplete.get(ids[0]) ?? new Error('No Concur entities are configured');

  const defaultId = [...entities.keys()][0];
  return {
    defaultId,
    list: () => [...entities.values()].map(({ id, label }) => ({ id, label })),
    require: (id?: string | null) => {
      if (!id?.trim()) return entities.get(defaultId)!;
      const entity = entities.get(id);
      if (entity) return entity;
      const configurationError = incomplete.get(id);
      if (configurationError) throw configurationError;
      throw new Error(`Unknown Concur entity "${id}"`);
    },
  };
}
