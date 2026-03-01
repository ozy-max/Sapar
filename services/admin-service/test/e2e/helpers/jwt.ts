import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long!!';

export const ADMIN_USER_ID = '00000000-0000-4000-a000-000000000001';
export const OPS_USER_ID = '00000000-0000-4000-a000-000000000002';
export const SUPPORT_USER_ID = '00000000-0000-4000-a000-000000000003';
export const NO_ROLE_USER_ID = '00000000-0000-4000-a000-000000000004';

export function signToken(userId: string, roles: string[]): string {
  return jwt.sign(
    { sub: userId, email: `${userId}@test.com`, roles },
    JWT_SECRET,
    { expiresIn: 3600 },
  );
}

export function auth(userId: string, roles: string[]): string {
  return `Bearer ${signToken(userId, roles)}`;
}

export const ADMIN_AUTH = auth(ADMIN_USER_ID, ['ADMIN']);
export const OPS_AUTH = auth(OPS_USER_ID, ['OPS']);
export const SUPPORT_AUTH = auth(SUPPORT_USER_ID, ['SUPPORT']);
export const NO_ROLE_AUTH = `Bearer ${jwt.sign({ sub: NO_ROLE_USER_ID, email: 'norole@test.com', roles: [] }, JWT_SECRET, { expiresIn: 3600 })}`;
export const NO_ROLES_CLAIM_AUTH = `Bearer ${jwt.sign({ sub: NO_ROLE_USER_ID, email: 'norole@test.com' }, JWT_SECRET, { expiresIn: 3600 })}`;
