/**
 * Phase 1 — M1.5: frontend/backend contract repairs in `ops-store.ts`.
 *
 * Verifies that the data layer matches the real API envelopes and required
 * fields, and that masked financial inputs never produce a fabricated margin.
 * No network or database access: fetch is mocked locally.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Order, OrderDocument } from "@/lib/types";
import {
  createOrder,
  getOrder,
  grossMargin,
  reviewDocument,
  transitionOrder,
  updateOrderDimensions,
  uploadDocument,
} from "@/lib/ops-store";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function orderFixture(overrides: Record<string, unknown> = {}): Order {
  return {
    id: "order-1",
    clientId: "client-1",
    qualificationId: "qual-1",
    salesAgentId: "sales-1",
    sourceAgentId: "source-1",
    rtoId: "rto-1",
    status: "New",
    evidenceStatus: "Not Started",
    rtoSubmissionStatus: "Not Ready",
    certificateStatus: "Not Issued",
    sellingPrice: 5000,
    supplierCostSnapshot: 1500,
    otherCost: 100,
    currency: "AUD",
    rtoContactId: null,
    rtoContactName: null,
    licensingAuthority: null,
    licenceReference: null,
    licenceExpiry: null,
    certificateDeliveryMethod: null,
    certificateDeliveryDate: null,
    certificateTrackingNumber: null,
    priceCategoryId: null,
    priceListId: null,
    supplierRouteId: null,
    exchangeRate: null,
    convertedAmount: null,
    additionalFees: [],
    feeTotal: 0,
    paymentStatus: "Unpaid",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    history: [],
    ...overrides,
  } as unknown as Order;
}

function documentFixture(id = "doc-1"): OrderDocument {
  return {
    id,
    orderId: "order-1",
    clientId: "client-1",
    type: "Identity (passport / licence)",
    version: 1,
    fileName: "id.pdf",
    contentType: "application/pdf",
    sizeBytes: 10,
    status: "Received",
    receivedAt: "2026-01-01T00:00:00.000Z",
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as OrderDocument;
}

function stubFetch(
  handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>,
) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init)),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("M1.5 — order detail/mutation envelopes", () => {
  it("getOrder reads the flat detail response (no {order} envelope)", async () => {
    const order = orderFixture({ enrollmentCode: "SC-2026-0007", channelType: "B2C_BDC" });
    const fetchMock = stubFetch(() => jsonResponse(order));
    const result = await getOrder("order-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/orders/order-1", expect.any(Object));
    expect(result?.id).toBe("order-1");
    expect(result?.enrollmentCode).toBe("SC-2026-0007");
    expect(result?.channelType).toBe("B2C_BDC");
  });

  it("createOrder posts the body then reloads the full order", async () => {
    const created = orderFixture({ enrollmentCode: "SC-2026-0001" });
    const fetchMock = stubFetch((url, init) => {
      if (url === "/api/orders" && init?.method === "POST") {
        return jsonResponse(
          {
            order: {
              id: "order-1",
              enrollmentCode: "SC-2026-0001",
              channelType: "B2C_BDC",
            },
          },
          201,
        );
      }
      if (url === "/api/orders/order-1" && (!init?.method || init.method === "GET")) {
        return jsonResponse(created);
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });
    const result = await createOrder({
      clientId: "client-1",
      qualificationId: "qual-1",
      salesAgentId: "sales-1",
      sourceAgentId: "source-1",
      rtoId: "rto-1",
      sellingPrice: 5000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.id).toBe("order-1");
    expect(result.enrollmentCode).toBe("SC-2026-0001");
  });

  it("transitionOrder sends status and reloads instead of unwrapping {order}", async () => {
    const moved = orderFixture({ status: "Awaiting Documents" });
    let patchBody: unknown;
    const fetchMock = stubFetch((url, init) => {
      if (url === "/api/orders/order-1/status" && init?.method === "PATCH") {
        patchBody = JSON.parse(String(init.body));
        return jsonResponse({ ok: true, before: "New", after: "Awaiting Documents" });
      }
      if (url === "/api/orders/order-1") return jsonResponse(moved);
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });
    const result = await transitionOrder("order-1", "Awaiting Documents", "actor-1");
    expect(patchBody).toEqual({ status: "Awaiting Documents" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("Awaiting Documents");
  });

  it("updateOrderDimensions reloads the order after a successful patch", async () => {
    const updated = orderFixture({ evidenceStatus: "Received" });
    const fetchMock = stubFetch((url, init) => {
      if (url === "/api/orders/order-1/dimensions" && init?.method === "PATCH") {
        return jsonResponse({ ok: true });
      }
      if (url === "/api/orders/order-1") return jsonResponse(updated);
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });
    const result = await updateOrderDimensions(
      "order-1",
      { evidenceStatus: "Received" },
      "actor-1",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.evidenceStatus).toBe("Received");
  });
});

describe("M1.5 — document contracts", () => {
  it("uploadDocument includes the required clientId and returns a full document", async () => {
    const doc = documentFixture();
    let form: FormData | undefined;
    const fetchMock = stubFetch((url, init) => {
      if (url === "/api/documents/upload" && init?.method === "POST") {
        form = init.body as FormData;
        return jsonResponse({ id: "doc-1", version: 1 }, 201);
      }
      if (url === "/api/orders/order-1/documents") return jsonResponse({ documents: [doc] });
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });
    const file = new File(["pdf"], "id.pdf", { type: "application/pdf" });
    const result = await uploadDocument("order-1", "client-1", file, "Identity (passport / licence)");
    expect(form?.get("clientId")).toBe("client-1");
    expect(form?.get("orderId")).toBe("order-1");
    expect(form?.get("type")).toBe("Identity (passport / licence)");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.document.id).toBe("doc-1");
  });

  it("reviewDocument sends status (not verdict) and returns the reloaded document", async () => {
    const reviewed = documentFixture();
    reviewed.status = "Approved";
    let patchBody: unknown;
    const fetchMock = stubFetch((url, init) => {
      if (url === "/api/documents/doc-1/review" && init?.method === "PATCH") {
        patchBody = JSON.parse(String(init.body));
        return jsonResponse({ ok: true });
      }
      if (url === "/api/orders/order-1/documents") return jsonResponse({ documents: [reviewed] });
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });
    const result = await reviewDocument("doc-1", "order-1", "Approved", "actor-1");
    expect(patchBody).toEqual({ status: "Approved" });
    expect((patchBody as any).verdict).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("Approved");
  });
});

describe("M1.5 — masked-cost margin guard", () => {
  it("does not fabricate a margin when supplier cost is omitted for the role", () => {
    const masked = orderFixture();
    delete (masked as Partial<Order>).supplierCostSnapshot;
    expect(Number.isNaN(grossMargin(masked))).toBe(true);
    expect(grossMargin(orderFixture())).toBe(3400);
  });
});
