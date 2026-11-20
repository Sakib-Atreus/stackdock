import {
  lowestFreePort,
  PUBLIC_PORT_MAX,
  PUBLIC_PORT_MIN,
} from './project-ports.js';

describe('lowestFreePort', () => {
  it('starts at the minimum', () => {
    expect(lowestFreePort([])).toBe(PUBLIC_PORT_MIN);
  });
  it('fills gaps first', () => {
    expect(lowestFreePort([10_001, 10_003])).toBe(10_002);
  });
  it('returns null when full', () => {
    const all = Array.from(
      { length: PUBLIC_PORT_MAX - PUBLIC_PORT_MIN + 1 },
      (_, i) => PUBLIC_PORT_MIN + i,
    );
    expect(lowestFreePort(all)).toBeNull();
  });
});
