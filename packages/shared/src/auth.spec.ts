import { changePasswordSchema, loginSchema } from './auth.js';

describe('loginSchema', () => {
  it('normalises email to trimmed lowercase', () => {
    const parsed = loginSchema.parse({
      email: '  Admin@Example.COM ',
      password: 'x',
    });
    expect(parsed.email).toBe('admin@example.com');
  });

  it('rejects an invalid email', () => {
    expect(
      loginSchema.safeParse({ email: 'nope', password: 'x' }).success,
    ).toBe(false);
  });
});

describe('changePasswordSchema', () => {
  it('enforces the minimum length', () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: 'old-password-123',
        newPassword: 'short',
      }).success,
    ).toBe(false);
  });

  it('rejects reusing the current password', () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: 'same-password-123',
        newPassword: 'same-password-123',
      }).success,
    ).toBe(false);
  });
});
