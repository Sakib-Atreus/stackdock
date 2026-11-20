import { Redactor } from './redactor.js';

describe('Redactor', () => {
  it('masks every occurrence of each secret', () => {
    const r = new Redactor(['s3cr3t-value', 'postgres://u:pw123456@db/x']);
    expect(r.redact('a s3cr3t-value b s3cr3t-value')).toBe('a •••• b ••••');
    expect(r.redact('url=postgres://u:pw123456@db/x')).toBe('url=••••');
  });

  it('masks the longer secret first', () => {
    const r = new Redactor(['abcdef', 'abcdefghij']);
    expect(r.redact('abcdefghij')).toBe('••••');
  });

  it('ignores very short values to avoid mangling logs', () => {
    const r = new Redactor(['1', 'true', 'abc']);
    expect(r.redact('true 1 abc')).toBe('true 1 abc');
  });
});
