import { describe, expect, it } from 'vitest';
import { categories } from './categories';

describe('categories registry', () => {
  it('registers Identity as an implemented Users category', () => {
    const users = categories.find((category) => category.id === 'users');

    expect(users).toMatchObject({
      id: 'users',
      label: 'Identity',
      group: 'Users',
    });
    expect(users?.description).toContain('Login ID');
  });

  it('registers Forms & Fields as an implemented Foundation data category', () => {
    const forms = categories.find((category) => category.id === 'forms');

    expect(forms).toMatchObject({
      id: 'forms',
      label: 'Forms & Fields',
      group: 'Foundation data',
    });
    expect(forms?.description).toContain('form');
  });

  it('registers Locations as an implemented Foundation data category', () => {
    const locations = categories.find((category) => category.id === 'locations');

    expect(locations).toMatchObject({
      id: 'locations',
      label: 'Locations',
      group: 'Foundation data',
    });
    expect(locations?.description).toContain('Locations v3');
  });

  it('registers Localities as an implemented Foundation data category', () => {
    const localities = categories.find((category) => category.id === 'localities');

    expect(localities).toMatchObject({
      id: 'localities',
      label: 'Localities',
      group: 'Foundation data',
    });
    expect(localities?.description).toContain('Localities v5');
  });

  it('registers Expense Reports as an implemented Expense category', () => {
    const reports = categories.find((category) => category.id === 'reports');

    expect(reports).toMatchObject({
      id: 'reports',
      label: 'Expense Reports',
      group: 'Expense',
    });
    expect(reports?.description).toContain('Reports v3');
  });

  it('provides a renderer for every registered category', () => {
    expect(categories.every((category) => typeof category.render === 'function')).toBe(true);
  });
});
