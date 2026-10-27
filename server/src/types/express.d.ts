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
  /**
   * The role document ids the user holds. Needed where a decision depends on
   * *which* role is being edited rather than the union of its permissions —
   * see the self-lockout guard on `PATCH /roles/:id`.
   */
  roleIds: string[];
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