import { describe, expect, it } from 'vitest';
import type { ExpenseEntry } from '../types';
import { entryV3RawFields } from './entryV3Fields';

describe('entryV3RawFields', () => {
  it('lists populated values by raw API key in alphabetical order', () => {
    const entry = {
      ID: 'entry-1',
      IsPersonal: false,
      AdditionalCount: 0,
      Custom1: { Type: 'Text', Value: 'Cost center 42', Code: 'CC42' },
      UnknownArray: ['one', 'two'],
    } as ExpenseEntry & Record<string, unknown>;

    expect(entryV3RawFields(entry)).toEqual([
      { key: 'AdditionalCount', value: '0' },
      { key: 'Custom1', value: '{"Type":"Text","Value":"Cost center 42","Code":"CC42"}' },
      { key: 'ID', value: 'entry-1' },
      { key: 'IsPersonal', value: 'No' },
      { key: 'UnknownArray', value: '["one","two"]' },
    ]);
  });

  it('excludes empty values and transport metadata', () => {
    const entry = {
      ID: 'entry-1',
      URI: 'https://example.test/entry/entry-1',
      Links: [{ rel: 'self' }],
      links: [{ rel: 'self' }],
      EmptyText: '   ',
      EmptyArray: [],
      NullValue: null,
      MissingValue: undefined,
    } as ExpenseEntry & Record<string, unknown>;

    expect(entryV3RawFields(entry)).toEqual([{ key: 'ID', value: 'entry-1' }]);
  });

  it('formats booleans, numbers, objects, and trimmed strings', () => {
    const entry = {
      ID: 'entry-1',
      BooleanTrue: true,
      NumberValue: 12.5,
      ObjectValue: { active: true },
      TextValue: '  populated  ',
    } as ExpenseEntry & Record<string, unknown>;

    expect(entryV3RawFields(entry)).toEqual([
      { key: 'BooleanTrue', value: 'Yes' },
      { key: 'ID', value: 'entry-1' },
      { key: 'NumberValue', value: '12.5' },
      { key: 'ObjectValue', value: '{"active":true}' },
      { key: 'TextValue', value: 'populated' },
    ]);
  });
});
