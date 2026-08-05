import { beforeEach, describe, expect, it } from 'vitest';
import { entityRequestHeaders, setActiveEntity } from './entityStore';

describe('entityStore', () => {
  beforeEach(() => {
    setActiveEntity('us-uat');
  });

  it('adds the active entity to server requests', () => {
    setActiveEntity('eu-production');

    expect(entityRequestHeaders()).toEqual({ 'X-Concur-Entity': 'eu-production' });
  });
});
