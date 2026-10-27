import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A local stand-in for QuickBooks Online (BACKEND-PLAN B5).
 *
 * ## Why this exists
 *
 * B5's headline criterion is "a failed sync, retried, creates exactly one
 * QuickBooks record". With no sandbox credentials, nothing in the suite could
 * reach the real API, so the criterion was asserted but never exercised: the
 * tests proved the local record stayed singular while the actual HTTP call was
 * never made. That is how the retry-creates-a-duplicate bug survived B3, B4, B5
 * and an audit.
 *
 * This server implements the parts of Intuit's contract the integration uses —
 * the OAuth token endpoint and the v3 invoice/payment creates — so those calls
 * really happen over HTTP, really carry an Authorization header, really get a
 * token refresh, and the call count can be asserted.
 *
 * ## What this does NOT prove
 *
 * That Intuit behaves as documented. Only a sandbox run proves that. What it
 * does prove is everything on our side: the client, the payload mapping, the
 * retry guard, the idempotency key, the token rotation.
 *
 * ## Faithfulness
 *
 * It follows the real shapes closely enough to be a useful test:
 *  - `Authorization: Basic …` on the token endpoint
 *  - `?minorversion=` on v3 calls
 *  - `Fault.Error[]` on a rejection, so the error flattener is exercised
 *  - rotating refresh tokens, so stale-token handling is exercised
 *  - rotating access tokens, so the expiry/refresh path is exercised
 */

export interface QBStub {
  url: string;
  /** How many times each entity type was actually created. */
  calls: { invoice: number; payment: number; token: number; refresh: number };
  /** The `DocNumber` of every invoice created, in order. */
  createdInvoiceDocNumbers: string[];
  lastAuthorizationHeader: string | null;
  /** Makes the next N create calls fail, to exercise the retry path. */
  failNextCreates(count: number): void;
  /** Expires the current access token so the next call must refresh. */
  expireAccessToken(): void;
  close(): Promise<void>;
}

const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;

export async function startQBStub(options?: {
  clientId?: string;
  clientSecret?: string;
  /**
   * Fixed port rather than an ephemeral one: the test has to put this URL into
   * `process.env` *before* the env module is imported, and an ephemeral port is
   * not known until after the server is listening.
   */
  port?: number;
}): Promise<QBStub> {
  const clientId = options?.clientId ?? "stub-client-id";
  const clientSecret = options?.clientSecret ?? "stub-client-secret";

  const state = {
    accessToken: "access-token-1",
    refreshToken: "refresh-token-1",
    issuedAt: Date.now(),
    tokenCounter: 1,
    refreshCounter: 1,
  };

  const calls = { invoice: 0, payment: 0, token: 0, refresh: 0 };
  const createdInvoiceDocNumbers: string[] = [];
  let lastAuthorizationHeader: string | null = null;
  let forcedFailures = 0;

  const json = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  /** Intuit's error envelope, which the client's flattener must cope with. */
  const fault = (res: ServerResponse, code: string, message: string, detail?: string): void => {
    json(res, 400, {
      Fault: { type: "ValidationFault", Error: [{ code, Message: message, Detail: detail }] },
    });
  };

  const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => {
        data += chunk;
      });
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://stub");
      const body = await readBody(req);

      /* ----------------------------- OAuth ----------------------------- */
      if (url.pathname === "/oauth2/v1/tokens/bearer") {
        const auth = req.headers.authorization ?? "";
        const expected = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
        if (auth !== expected) {
          json(res, 401, { error: "invalid_client", error_description: "client credentials rejected" });
          return;
        }

        const params = new URLSearchParams(body);
        const grant = params.get("grant_type");

        if (grant === "refresh_token") {
          calls.refresh += 1;
          if (params.get("refresh_token") !== state.refreshToken) {
            json(res, 400, {
              error: "invalid_grant",
              error_description: "refresh token is invalid or has been rotated away",
            });
            return;
          }
          // Intuit rotates both halves on every refresh.
          state.tokenCounter += 1;
          state.refreshCounter += 1;
          state.accessToken = `access-token-${state.tokenCounter}`;
          state.refreshToken = `refresh-token-${state.refreshCounter}`;
        } else if (grant === "authorization_code") {
          calls.token += 1;
          state.tokenCounter += 1;
          state.refreshCounter += 1;
          state.accessToken = `access-token-${state.tokenCounter}`;
          state.refreshToken = `refresh-token-${state.refreshCounter}`;
        } else {
          json(res, 400, { error: "unsupported_grant_type", error_description: String(grant) });
          return;
        }

        state.issuedAt = Date.now();
        json(res, 200, {
          access_token: state.accessToken,
          refresh_token: state.refreshToken,
          expires_in: ACCESS_TOKEN_TTL_MS / 1000,
          x_refresh_token_expires_in: 8726400,
          token_type: "bearer",
        });
        return;
      }

      /* ------------------------------- v3 ------------------------------- */
      const v3 = /^\/v3\/company\/([^/]+)\/(invoice|payment)$/.exec(url.pathname);
      if (!v3) {
        json(res, 404, { Fault: { Error: [{ code: "404", Message: "Not found" }] } });
        return;
      }

      lastAuthorizationHeader = req.headers.authorization ?? null;

      if (!url.searchParams.get("minorversion")) {
        fault(res, "5000", "minorversion is required");
        return;
      }

      const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      if (bearer !== state.accessToken) {
        json(res, 401, {
          Fault: { Error: [{ code: "3200", Message: "token expired", Detail: "OAuth access token expired" }] },
        });
        return;
      }

      const kind = v3[2] as "invoice" | "payment";
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(body) as Record<string, unknown>;
      } catch {
        fault(res, "2000", "Invalid JSON in request body");
        return;
      }

      if (forcedFailures > 0) {
        forcedFailures -= 1;
        fault(res, "4000", "Simulated QuickBooks failure", "retry me");
        return;
      }

      // A minimal but real validation, so our payload mistakes are caught here
      // the way they would be in the sandbox.
      if (!parsed.CustomerRef || typeof (parsed.CustomerRef as { value?: unknown }).value !== "string") {
        fault(res, "2010", "CustomerRef is required");
        return;
      }

      if (kind === "invoice") {
        calls.invoice += 1;
        const docNumber = typeof parsed.DocNumber === "string" ? parsed.DocNumber : `QB-${calls.invoice}`;
        createdInvoiceDocNumbers.push(docNumber);
        json(res, 200, {
          Invoice: {
            Id: `QB-INV-${calls.invoice}`,
            SyncToken: "1",
            DocNumber: docNumber,
            domain: "QBO",
          },
        });
        return;
      }

      calls.payment += 1;
      json(res, 200, {
        Payment: { Id: `QB-PAY-${calls.payment}`, SyncToken: "1", domain: "QBO" },
      });
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options?.port ?? 0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    createdInvoiceDocNumbers,
    get lastAuthorizationHeader() {
      return lastAuthorizationHeader;
    },
    failNextCreates(count: number) {
      forcedFailures = count;
    },
    expireAccessToken() {
      // Rotate the token without telling the client, so its next call 401s and
      // the refresh path has to rescue it.
      state.tokenCounter += 1;
      state.accessToken = `access-token-${state.tokenCounter}`;
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}