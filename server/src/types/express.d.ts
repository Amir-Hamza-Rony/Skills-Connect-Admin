import type { Permission } from "../services/permissions.js";

/**
 * The authenticated principal attached to the request by `requireAuth`.
 * Every downstream handler and service can rely on `req.auth` being present.
 */
export interface AuthContext {
  userId: string;
  email: string;
  name: string;
  roleNames: string[];
  permissions: Permission[];
  /** When the current access token was issued — used to detect stale tokens. */
  tokenIssuedAt: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export {};