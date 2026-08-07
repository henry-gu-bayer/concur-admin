import { describe, expect, it } from 'vitest';
import { categories } from './categories';

describe('categories registry', () => {
  it('registers Users as an implemented Identity category', () => {
    const users = categories.find((category) => category.id === 'users');

    expect(users).toMatchObject({
      id: 'users',
      label: 'Users',
      group: 'Identity',
      implemented: true,
    });
    expect(users?.description).toContain('Login ID');
  });

  it('registers Forms & Fields as an implemented Foundation data category', () => {
    const forms = categories.find((category) => category.id === 'forms');

    expect(forms).toMatchObject({
      id: 'forms',
      label: 'Forms & Fields',
      group: 'Foundation data',
      implemented: true,
    });
    expect(forms?.description).toContain('form');
  });
});
