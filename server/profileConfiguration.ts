/**
 * Company codes are commonly stored in a Spend custom-data field, but the
 * field differs between tenants. Keep the setting server-side alongside the
 * entity credentials so custom-field conventions never leak into the client.
 */
function entityKey(entityId: string): string {
  return entityId.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export function companyCodeCustomField(entityId: string): string {
  return process.env[`CONCUR_${entityKey(entityId)}_COMPANY_CODE_CUSTOM_FIELD`]?.trim()
    || process.env.CONCUR_COMPANY_CODE_CUSTOM_FIELD?.trim()
    || 'custom11';
}
