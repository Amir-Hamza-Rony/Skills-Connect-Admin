# Permission Matrix — Phase 0

**Source of truth:** Boss reference documents (§3 Role-Based Visibility Matrix, §4.1 Users table).

## Four-Role Permission Matrix

| Permission | SUPER_ADMIN | ADMIN | BDC | B2B_AGENT |
|------------|:-----------:|:-----:|:---:|:---------:|
| users.manage | ✅ | ✅ | ❌ | ❌ |
| roles.manage | ✅ | ✅ | ❌ | ❌ |
| clients.view | ✅ | ✅ | ✅ (own) | ✅ (own agency) |
| clients.manage | ✅ | ✅ | ✅ (own) | ✅ (own agency) |
| orders.view | ✅ | ✅ | ✅ (own B2C) | ✅ (own agency) |
| orders.manage | ✅ | ✅ | ✅ (own B2C) | ✅ (own agency) |
| qualifications.manage | ✅ | ✅ | ❌ | ❌ |
| pricing.manage | ✅ | ✅ | ❌ | ❌ |
| documents.view | ✅ | ✅ | ✅ (own) | ✅ (own agency) |
| documents.review | ✅ | ✅ | ❌ | ❌ |
| finance.view | ✅ | ✅ | ❌ | ❌ |
| finance.manage | ✅ | ✅ | ❌ | ❌ |
| reports.view | ✅ | ✅ | ✅ (own) | ✅ (own agency) |
| audit.view | ✅ | ✅ | ❌ | ❌ |
| settings.manage | ✅ | ✅ | ❌ | ❌ |

## Column-Level Visibility Matrix (Financial Field Masking)

| Data Field | SUPER_ADMIN | ADMIN | BDC | B2B_AGENT |
|------------|:-----------:|:-----:|:---:|:---------:|
| Partner Cost (`partner_cost_price` / `supplierCostSnapshot`) | Read/Write | Read/Write | **Hidden** | **Hidden** |
| Net Profit (`net_profit`) | Read/Write | Read/Write | **Hidden** | **Hidden** |
| BDC Base Price (`bdc_base_price`) | Read/Write | Read/Write | Read Only | **Hidden** |
| BDC Standard Price (`bdc_standard_price`) | Read/Write | Read/Write | Read Only | **Hidden** |
| B2B Silver Price (`b2b_silver_price`) | Read/Write | Read/Write | **Hidden** | Read Only (assigned tier) |
| B2B Gold Price (`b2b_gold_price`) | Read/Write | Read/Write | **Hidden** | Read Only (if configured) |

## Data Scoping Rules

| Role | Scope | Enforcement |
|------|-------|-------------|
| SUPER_ADMIN | All enrollments, all users, all data | No filtering |
| ADMIN | All enrollments, all users, all data | No filtering |
| BDC | Own B2C enrollments only (`bdc_id` = current user) | Server-side query filter on `bdc_id` |
| B2B_AGENT | Own agency enrollments only (`b2b_agent_id` = current user) | Server-side query filter on `b2b_agent_id` |

**Scoping applies to:** list, detail, update, delete, search, export, and reporting API operations.

**Frontend filtering is never used for security.** All scoping is enforced in API route handlers.

## Route → Permission Mapping

| Route | Required Permission | Roles |
|-------|---------------------|-------|
| /dashboard | null | All |
| /clients | clients.view | All |
| /orders | orders.view | All |
| /qualifications | qualifications.manage | SUPER_ADMIN, ADMIN |
| /rtos | rto.manage | SUPER_ADMIN, ADMIN |
| /agents | agents.manage | SUPER_ADMIN, ADMIN |
| /pricing | pricing.manage | SUPER_ADMIN, ADMIN |
| /documents | documents.view | All |
| /workflow | orders.view | All |
| /finance | finance.view | SUPER_ADMIN, ADMIN |
| /reports | reports.view | All (scoped) |
| /audit | audit.view | SUPER_ADMIN, ADMIN |
| /settings | settings.manage | SUPER_ADMIN, ADMIN |
| /users | users.manage | SUPER_ADMIN, ADMIN |
| /roles | roles.manage | SUPER_ADMIN, ADMIN |
| /reconciliation | finance.reconcile | SUPER_ADMIN, ADMIN |
| /integrations/quickbooks | qb.manage | SUPER_ADMIN, ADMIN |

## Default Dashboard View per Role

| Role | Default View |
|------|-------------|
| SUPER_ADMIN | management |
| ADMIN | management |
| BDC | agent |
| B2B_AGENT | agent |
