import * as jwt from 'jsonwebtoken';

const SECRET = 'test-jwt-secret-at-least-32-characters-long!!';

export function signToken(userId: string, email = 'test@sapar.kg'): string {
  return jwt.sign({ sub: userId, email }, SECRET, { expiresIn: '1h' });
}
