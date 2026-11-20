import { ownUrlFor } from './own-url.js';

const HOSTS =
  'dash--stackdock--proj--abc1.code.run, shop--stackdock--proj--abc1.code.run,shop.example.com';

describe('ownUrlFor', () => {
  it('finds the code.run host for a port name', () => {
    expect(ownUrlFor('shop', HOSTS)).toBe(
      'https://shop--stackdock--proj--abc1.code.run/',
    );
    expect(ownUrlFor('dash', HOSTS)).toBe(
      'https://dash--stackdock--proj--abc1.code.run/',
    );
  });
  it('does not match a port whose name is only a prefix', () => {
    expect(ownUrlFor('sho', HOSTS)).toBeNull();
  });
  it('returns null when missing or not on Northflank', () => {
    expect(ownUrlFor('blog', HOSTS)).toBeNull();
    expect(ownUrlFor('shop', undefined)).toBeNull();
  });
});
