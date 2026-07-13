import { isClubAdmin, isClubOwner } from '../lib/adminRole';

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

describe('isClubOwner', () => {
  it('seul OWNER est gérant', () => {
    expect(isClubOwner('OWNER')).toBe(true);
    expect(isClubOwner('ADMIN')).toBe(false);
    expect(isClubOwner('STAFF')).toBe(false);
    expect(isClubOwner(null)).toBe(false);
    expect(isClubOwner(undefined)).toBe(false);
  });
});
