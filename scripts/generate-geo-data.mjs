// Generates src/data/countries.json (ISO 3166-1 alpha-2) and
// src/data/subdivisions.json (ISO 3166-2, grouped by country code).
// Run: node scripts/generate-geo-data.mjs
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const countriesLib = require('i18n-iso-countries');
const iso31662 = require('iso-3166-2');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'src', 'data');
mkdirSync(outDir, { recursive: true });

const countries = Object.entries(countriesLib.getNames('en', { select: 'official' }))
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

const subdivisions = {};
for (const [countryCode, entry] of Object.entries(iso31662.data)) {
  const subs = Object.entries(entry.sub ?? {})
    .map(([code, s]) => ({ code, name: s.name, type: s.type }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (subs.length > 0) subdivisions[countryCode] = subs;
}

writeFileSync(join(outDir, 'countries.json'), JSON.stringify(countries, null, 1) + '\n');
writeFileSync(join(outDir, 'subdivisions.json'), JSON.stringify(subdivisions, null, 1) + '\n');

console.log(`countries.json: ${countries.length} countries`);
console.log(`subdivisions.json: ${Object.keys(subdivisions).length} countries, ${Object.values(subdivisions).reduce((n, s) => n + s.length, 0)} subdivisions`);
