import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  qbTransportConfig,
  syncCustomer,
  syncInvoice,
  syncPayment,
  qbQuery,
  qbTransportReady,
  type QBTransportConfig,
} from "@/lib/quickbooks-transport";
import * as qbModule from "@/lib/quickbooks";

// Save and restore env.
const origEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...origEnv };
  delete process.env.QB_REALM_ID;
  delete process.env.QB_SANDBOX;
  delete process.env.QB_REQUEST_TIMEOUT_MS;
  delete process.env.QB_CLIENT_ID;
  delete process.env.QB_CLIENT_SECRET;
  delete process.env.QB_ENCRYPTION_KEY;
  vi.restoreAllMocks();
});

afterEach(() => {
  process.env = { ...origEnv };
  vi.restoreAllMocks();
});

function mockFetch(response: any, status = 200, ok = true) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(response), {
      status,
      headers: { "Content-Type": "application/json" },
      ...(ok ? {} : {}),
    }),
  ) as any;
}

describe("Phase 8C-3 — QuickBooks transport", () => {
  describe("qbTransportConfig", () => {
    it("returns null when QB_REALM_ID is missing", () => {
      expect(qbTransportConfig()).toBeNull();
    });

    it("returns config when QB_REALM_ID is present", () => {
      process.env.QB_REALM_ID = "realm-123";
      const config = qbTransportConfig();
      expect(config).toBeTruthy();
      expect(config!.realmId).toBe("realm-123");
      expect(config!.sandbox).toBe(true);
      expect(config!.timeoutMs).toBe(15000);
    });

    it("respects QB_SANDBOX=false", () => {
      process.env.QB_REALM_ID = "realm-123";
      process.env.QB_SANDBOX = "false";
      const config = qbTransportConfig();
      expect(config!.sandbox).toBe(false);
    });

    it("respects QB_REQUEST_TIMEOUT_MS", () => {
      process.env.QB_REALM_ID = "realm-123";
      process.env.QB_REQUEST_TIMEOUT_MS = "30000";
      const config = qbTransportConfig();
      expect(config!.timeoutMs).toBe(30000);
    });
  });

  describe("qbTransportReady", () => {
    it("returns false without credentials", () => {
      expect(qbTransportReady()).toBe(false);
    });

    it("returns true with all credentials", () => {
      process.env.QB_CLIENT_ID = "client-id";
      process.env.QB_CLIENT_SECRET = "client-secret";
      process.env.QB_REALM_ID = "realm-123";
      expect(qbTransportReady()).toBe(true);
    });
  });

  describe("syncCustomer", () => {
    const config: QBTransportConfig = {
      realmId: "realm-123",
      sandbox: true,
      timeoutMs: 15000,
    };

    it("returns QB_NOT_CONFIGURED when QB is not configured", async () => {
      // QB_CLIENT_ID not set
      const result = await syncCustomer(config, {
        displayName: "Test Customer",
        currency: "AUD",
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe("QB_NOT_CONFIGURED");
    });

    it("returns QB_CURRENCY_MISMATCH for non-AUD currency", async () => {
      process.env.QB_CLIENT_ID = "client-id";
      process.env.QB_CLIENT_SECRET = "client-secret";
      const result = await syncCustomer(config, {
        displayName: "Test Customer",
        currency: "BDT",
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe("QB_CURRENCY_MISMATCH");
      expect(result.statusCode).toBe(400);
    });

    it("syncs a customer successfully", async () => {
      process.env.QB_CLIENT_ID = "client-id";
      process.env.QB_CLIENT_SECRET = "client-secret";
      mockFetch({ Customer: { Id: "qb-cust-1" } });

      // Mock getAccessToken to return a token
      vi.spyOn(qbModule, "getAccessToken").mockResolvedValue(
        "access-token",
      );

      const result = await syncCustomer(config, {
        displayName: "Test Customer",
        currency: "AUD",
        email: "test@example.com",
      });
      expect(result.ok).toBe(true);
      expect(result.qbReference).toBe("qb-cust-1");
    });

    it("handles QB auth failure (401)", async () => {
      process.env.QB_CLIENT_ID = "client-id";
      process.env.QB_CLIENT_SECRET = "client-secret";
      mockFetch({ error: "invalid_token" }, 401, false);

      vi.spyOn(qbModule, "getAccessToken").mockResolvedValue(
        "access-token",
      );

      const result = await syncCustomer(config, {
        displayName: "Test Customer",
        currency: "AUD",
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe("QB_AUTH_FAILED");
    });
  });

  describe("syncInvoice", () => {
    const config: QBTransportConfig = {
      realmId: "realm-123",
      sandbox: true,
      timeoutMs: 15000,
    };

    it("returns QB_CURRENCY_MISMATCH for non-AUD currency", async () => {
      process.env.QB_CLIENT_ID = "client-id";
      process.env.QB_CLIENT_SECRET = "client-secret";
      const result = await syncInvoice(config, {
        customerRef: { value: "cust-1" },
        line: [{ amount: 1000, detailType: "SalesItemLineDetail" }],
        currency: "USD",
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe("QB_CURRENCY_MISMATCH");
    });

    it("syncs an invoice successfully", async () => {
      process.env.QB_CLIENT_ID = "client-id";
      process.env.QB_CLIENT_SECRET = "client-secret";
      mockFetch({ Invoice: { Id: "qb-inv-1" } });

      vi.spyOn(qbModule, "getAccessToken").mockResolvedValue(
        "access-token",
      );

      const result = await syncInvoice(config, {
        customerRef: { value: "cust-1", name: "Test Customer" },
        line: [
          {
            amount: 1000,
            detailType: "SalesItemLineDetail",
            description: "Tuition",
          },
        ],
        currency: "AUD",
        docNumber: "INV-001",
      });
      expect(result.ok).toBe(true);
      expect(result.qbReference).toBe("qb-inv-1");
    });
  });

  describe("syncPayment", () => {
    const config: QBTransportConfig = {
      realmId: "realm-123",
      sandbox: true,
      timeoutMs: 15000,
    };

    it("returns QB_CURRENCY_MISMATCH for non-AUD currency", async () => {
      process.env.QB_CLIENT_ID = "client-id";
      process.env.QB_CLIENT_SECRET = "client-secret";
      const result = await syncPayment(config, {
        customerRef: { value: "cust-1" },
        amount: 1000,
        currency: "EUR",
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe("QB_CURRENCY_MISMATCH");
    });

    it("syncs a payment successfully", async () => {
      process.env.QB_CLIENT_ID = "client-id";
      process.env.QB_CLIENT_SECRET = "client-secret";
      mockFetch({ Payment: { Id: "qb-pay-1" } });

      vi.spyOn(qbModule, "getAccessToken").mockResolvedValue(
        "access-token",
      );

      const result = await syncPayment(config, {
        customerRef: { value: "cust-1", name: "Test Customer" },
        amount: 1000,
        currency: "AUD",
        docNumber: "PAY-001",
      });
      expect(result.ok).toBe(true);
      expect(result.qbReference).toBe("qb-pay-1");
    });
  });

  describe("qbQuery", () => {
    const config: QBTransportConfig = {
      realmId: "realm-123",
      sandbox: true,
      timeoutMs: 15000,
    };

    it("returns QB_NOT_CONFIGURED when QB is not configured", async () => {
      const result = await qbQuery(config, "SELECT * FROM Customer");
      expect(result.ok).toBe(false);
      expect(result.error).toBe("QB_NOT_CONFIGURED");
    });

    it("queries successfully", async () => {
      process.env.QB_CLIENT_ID = "client-id";
      process.env.QB_CLIENT_SECRET = "client-secret";
      mockFetch({
        QueryResponse: {
          Customer: [{ Id: "1", DisplayName: "Test" }],
          totalCount: 1,
        },
      });

      vi.spyOn(qbModule, "getAccessToken").mockResolvedValue(
        "access-token",
      );

      const result = await qbQuery(config, "SELECT * FROM Customer");
      expect(result.ok).toBe(true);
      expect(result.entities.length).toBe(1);
      expect(result.entities[0].Id).toBe("1");
    });
  });
});
