# Role Migration Analysis — Phase 0

**Source of truth:** Boss reference documents (`docs/reference/`) define exactly 4 roles:
`SUPER_ADMIN`, `ADMIN`, `BDC`, `B2B_AGENT`.

**Existing system:** 7 roles — `Super Admin`, `Finance`, `Operations`, `Sales / Closing Agent`, `RTO / Sourcing Manager`, `Document Reviewer`, `Read Only / Manager`.

## 1. Current User Records (Database Audit)

Queried the `users` collection in MongoDB (`skills_connect_admin`). Credentials and personal data are **not** disclosed.

| User ID | Name | Email | Active | Roles |
|---------|------|-------|--------|-------|
| `6af3fce2741e21602a3a493b` | Super Admin | admin@skillsconnect.example | true | `["Super Admin"]` |

**Total users: 1**

No other users exist. No credentials or personal data were logged or exposed.

## 2. Legacy Role → New Role Mapping Proposal

**Principle:** No automatic mapping. Each legacy role is listed with a proposed mapping that requires business approval before execution.

| Legacy Role | Proposed New Role | Rationale | Approval Required |
|-------------|-------------------|-----------|-------------------|
| `Super Admin` | `SUPER_ADMIN` | Direct semantic match — full system access. | YES |
| `Finance` | `ADMIN` | Finance manages financial data; ADMIN has full read/write in boss model. | YES — Finance may need restricted financial-only access instead |
| `Operations` | `ADMIN` | Operations manages clients/orders/documents; ADMIN covers this scope. | YES |
| `Sales / Closing Agent` | `BDC` | Sales/Closing Agent enrolls B2C students; maps to BDC (B2C channel). | YES |
| `RTO / Sourcing Manager` | `ADMIN` | Manages RTOs, agents, qualifications, pricing; ADMIN has full access. | YES |
| `Document Reviewer` | `ADMIN` | Reviews documents; ADMIN can approve/reject documents. | YES — may need document-review-only scope |
| `Read Only / Manager` | `ADMIN` | Read-only across all data; ADMIN has write access — over-privileged. | YES — may need read-only variant |

**Existing user impact:** The single existing user has role `Super Admin` → proposed `SUPER_ADMIN`. This is a direct match and low risk.

**No existing user records will be modified** without explicit business approval of the mapping above.

## 3. Roles That Must NOT Auto-Map to ADMIN

Per task restrictions:
- `Finance` → must not automatically become `ADMIN`
- `Operations` → must not automatically become `ADMIN`
- `RTO / Sourcing Manager` → must not automatically become `ADMIN`
- `Document Reviewer` → must not automatically become `ADMIN`
- `Read Only / Manager` → must not automatically become `ADMIN`

Each requires individual review and business approval before any user assignment change.

## 4. Reversible Migration Design

A dry-run migration script will:
1. Read all users from the `users` collection
2. For each user, report legacy role → proposed new role mapping
3. **Not write any changes** unless `--apply` flag is passed AND mapping is approved
4. Preserve all existing user data (email, name, phone, active, etc.)
5. Add new fields (`agency_name`, `b2b_tier`, `default_commission_pct`, `full_name`) with defaults

**Dry-run command (read-only):**
```
node scripts/migrate-roles.js --dry-run
```

**Apply command (requires approval):**
```
node scripts/migrate-roles.js --apply --approve-mapping "Super Admin:SUPER_ADMIN"
```

## 5. Fields Added to User Records

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `full_name` | string | existing `name` value | Mirror of `name` for boss-spec compatibility |
| `agency_name` | string \| null | null | Required for B2B_AGENT |
| `b2b_tier` | string | `SILVER` | `SILVER`, `GOLD`, `PLATINUM` |
| `default_commission_pct` | decimal | 0.00 | Default commission % for BDCs |
| `role` | string | existing primary role | Single role string (boss model uses one role per user) |

**Backward compatibility:** `name` and `roleNames` (array) are preserved for existing code paths. New code uses `role` (string) and `full_name`.

## 6. Approval Checklist

Before executing any migration:

- [ ] Business approves `Super Admin` → `SUPER_ADMIN` for the existing admin user
- [ ] Business decides target role for each legacy role (no auto-mapping)
- [ ] Business confirms no existing users with legacy roles need preservation
- [ ] Dry-run executed and output reviewed
- [ ] `--apply` executed only with explicit approval
