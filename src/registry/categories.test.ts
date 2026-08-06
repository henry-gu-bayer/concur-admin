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
});
