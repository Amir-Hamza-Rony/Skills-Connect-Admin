# Field Masking Audit — Phase 0

## Overview

Financial fields are masked at the API response layer based on the requesting user's role. Masking is enforced in route handlers, not UI components.

## Masking Rules by Role

| Data Field | SUPER_ADMIN | ADMIN | BDC | B2B_AGENT |
|------------|:-----------:|:-----:|:---:|:---------:|
| `supplierCostSnapshot` (partner cost) | ✅ Visible | ✅ Visible | ❌ Hidden | ❌ Hidden |
| `grossMargin` / `net_profit` | ✅ Visible | ✅ Visible | ❌ Hidden | ❌ Hidden |
| `sellingPrice` (BDC base/standard equivalent) | ✅ Visible | ✅ Visible | ✅ Visible | ❌ Hidden |
| `b2b_silver_price` / `b2b_gold_price` | ✅ Visible | ✅ Visible | ❌ Hidden | ✅ Visible (assigned tier) |

## API Coverage

### Implemented (masking added)

| Endpoint | Method | Masked Fields | Roles Masked |
|----------|--------|--------------|--------------|
| `/api/orders` | GET | `supplierCostSnapshot` | BDC, B2B_AGENT |
| `/api/orders/[id]` | GET | `supplierCostSnapshot` | BDC, B2B_AGENT |

### Not Yet Masked (Phase 1+)

| Endpoint | Method | Fields Needing Masking |
|----------|--------|----------------------|
| `/api/reports/revenue` | GET | revenue, margin figures |
| `/api/reports/margin` | GET | gross margin, net profit |
| `/api/reports/finance` | GET | finance summary figures |
| `/api/export/*` | GET | all financial fields in export |

## Implementation Detail

In `GET /api/orders`, the response object is built conditionally:

```typescript
const item: Record<string, unknown> = {
  // ... non-financial fields ...
};
if (isAdminOrSuperAdmin(auth)) {
  item.supplierCostSnapshot = o.supplierCostSnapshot;
}
```

The `grossMargin` field is computed client-side in `ops-store.ts` (Phase 0 does not change this — it remains a display helper). Server-side `gross_profit`/`net_profit` storage is a Phase 1 requirement.

## Export APIs

Export routes (`/api/reports/[type]/export`) return all data without masking. These must be updated in Phase 1+ to respect role-based field masking before production use.
