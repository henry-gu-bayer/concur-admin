import { existsSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Keep disk snapshots stable across configuration casing. Entity IDs remain
 * user-facing configuration values, while their data directory is always a
 * lowercase filesystem key (for example, `US-UAT` stores under `us-uat`).
 */
export function entityDataDirectory(entityId: string): string {
  const root = process.env.DATA_DIR ?? 'data';
  const configuredId = entityId.trim();
  const normalizedId = configuredId.toLowerCase();
  const directory = join(root, normalizedId);
  // Migrate a previously created mixed-case directory without overwriting a
  // lowercase directory that may already contain newer snapshots. On the
  // default case-insensitive macOS filesystem, use a temporary name so a
  // case-only rename is applied rather than silently ignored.
  if (configuredId !== normalizedId && existsSync(root)) {
    const entries = readdirSync(root);
    const legacyName = entries.find((entry) => entry === configuredId);
    if (legacyName && !entries.includes(normalizedId)) {
      const legacyDirectory = join(root, legacyName);
      const temporaryDirectory = join(root, `.concur-entity-rename-${normalizedId}-${process.pid}-${Date.now()}`);
      renameSync(legacyDirectory, temporaryDirectory);
      try {
        renameSync(temporaryDirectory, directory);
      } catch (error) {
        renameSync(temporaryDirectory, legacyDirectory);
        throw error;
      }
    }
  }
  return directory;
}
