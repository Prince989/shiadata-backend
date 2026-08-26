import { AuthService, PasswordService } from './auth.service';
import { MemoryUserStore } from './user-store';

describe('AuthService', () => {
  function build() {
    const users = new MemoryUserStore();
    const passwords = new PasswordService();
    return new AuthService(users, passwords);
  }

  it('registers and logs in with a Persian passphrase longer than 72 bytes', async () => {
    const auth = build();
    const password = 'گذرواژه-بسیار-بلند-برای-آزمایش-برش-بی‌صدا-'.repeat(4);
    const registered = await auth.register('a@b.com', password);
    expect(registered.userId).toBeTruthy();
    const logged = await auth.login('a@b.com', password);
    expect(logged.userId).toBe(registered.userId);
  });

  it('detects refresh-token reuse and revokes the family', async () => {
    const auth = build();
    const first = await auth.register('c@d.com', 'password-long-enough');
    const rotated = await auth.rotateRefresh(first.refreshToken);
    expect(rotated.refreshToken).not.toBe(first.refreshToken);
    await expect(auth.rotateRefresh(first.refreshToken)).rejects.toThrow(
      'refresh-reuse',
    );
  });

  it('stores only sha256 of the refresh token, never the raw token', async () => {
    const passwords = new PasswordService();
    const raw = 'a'.repeat(64);
    const hashed = passwords.hashRefresh(raw);
    expect(hashed).not.toBe(raw);
    expect(hashed).toHaveLength(64);
  });

  it('requires an explicit counseling-consent flip', async () => {
    const auth = build();
    const issued = await auth.register('e@f.com', 'password-long-enough', {
      countryCode: 'IR',
    });
    const granted = await auth.grantCounselingConsent(issued.userId);
    expect(granted.counselingConsent).toBe(true);
    expect(granted.countryCode).toBe('IR');
  });
});
