import type { AuthClaims } from '../auth/jwt';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        claims: AuthClaims;
        scopes: string[];
      };
    }
  }
}

export {};

