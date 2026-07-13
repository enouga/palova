import { isClubAdmin } from '../lib/adminRole';

describe('isClubAdmin', () => {
  it('OWNER et ADMIN sont admins', () => {
    expect(isClubAdmin('OWNER')).toBe(true);
    expect(isClubAdmin('ADMIN')).toBe(true);
  });

  it('STAFF, null et undefined ne le sont pas', () => {
    expect(isClubAdmin('STAFF')).toBe(false);
    expect(isClubAdmin(null)).toBe(false);
    expect(isClubAdmin(undefined)).toBe(false);
  });
});
