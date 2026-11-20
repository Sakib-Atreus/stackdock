import { toErrorBody } from './api-exception.filter.js';

describe('toErrorBody', () => {
  it('maps validation message arrays to a fields map', () => {
    const body = toErrorBody(400, {
      message: ['email: Invalid email', 'email: Too short', 'name: Required'],
    });
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.fields).toEqual({
      email: ['Invalid email', 'Too short'],
      name: ['Required'],
    });
  });

  it('keeps safe 4xx messages', () => {
    expect(toErrorBody(404, { message: 'Project not found' }).error).toEqual({
      code: 'NOT_FOUND',
      message: 'Project not found',
    });
  });

  it('passes AppError code and message through, even for 5xx', () => {
    const body = toErrorBody(503, {
      code: 'PROVIDER_UNAVAILABLE',
      message: 'Northflank is not responding.',
      details: { retryAfterSeconds: 30 },
    });
    expect(body.error).toEqual({
      code: 'PROVIDER_UNAVAILABLE',
      message: 'Northflank is not responding.',
      details: { retryAfterSeconds: 30 },
    });
  });

  it('hides internal messages for 5xx', () => {
    const body = toErrorBody(502, { message: 'upstream said: token=abc' });
    expect(body.error.message).toBe('Something went wrong.');
  });
});
