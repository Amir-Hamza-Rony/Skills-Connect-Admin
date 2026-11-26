/**
 * Seed script: populates the database with sample Master Hub data so the
 * system has content to display on first run.
 *
 * Run with:  npx tsx scripts/seed-master-hub.ts
 *
 * Seeds:
 *   • Agents (certificate_source, sales_closing, rto_contact) with demo contacts
 *   • Qualifications (course codes)
 *   • RTOs
 *   • Qualification↔RTO mappings
 *   • Supplier routes (wholesale costs)
 *   • Users (Super Admin, Admin, BDC, B2B Agent, Employee) with demo contacts
 */

import { collection } from "@/lib/db"
import { generateDemoContact } from "@/lib/demo-contact"
import { hashPassword } from "@/lib/api-auth"

const NOW = new Date()

const AGENTS = [
  { name: "Global Source Partners", type: "certificate_source" as const, contact: "", commissionRule: "10% of margin" },
  { name: "Pacific RTO Network", type: "certificate_source" as const, contact: "", commissionRule: "12% of margin" },
  { name: "Southern Cross Sales", type: "sales_closing" as const, contact: "", commissionRule: "8% of margin" },
  { name: "Northern Territory RTO Desk", type: "rto_contact" as const, contact: "", commissionRule: null },
]

const QUALIFICATIONS = [
  { code: "AUR32120", title: "Certificate III in Automotive Body Repair Technology", trainingPackage: "AUR", industry: "Automotive" },
  { code: "CPC30220", title: "Certificate III in Carpentry", trainingPackage: "CPC", industry: "Construction" },
  { code: "SIT30622", title: "Certificate III in Hospitality", trainingPackage: "SIT", industry: "Hospitality" },
  { code: "CHC33021", title: "Certificate III in Individual Support", trainingPackage: "CHC", industry: "Community Services" },
  { code: "BSB30120", title: "Certificate III in Business", trainingPackage: "BSB", industry: "Business" },
  { code: "UEE30820", title: "Certificate III in Electrotechnology Electrician", trainingPackage: "UEE", industry: "Electrotechnology" },
]

const RTOS = [
  { legalName: "Melbourne Technical College Pty Ltd", tradingName: "Melbourne Tech", rtoCode: "MTC001", cricosCode: "01234J" },
  { legalName: "Sydney Institute of Trades", tradingName: "Sydney Trades", rtoCode: "SIT002", cricosCode: "02345K" },
  { legalName: "Brisbane Hospitality Academy", tradingName: "Brisbane Hosp", rtoCode: "BHA003", cricosCode: "03456L" },
  { legalName: "Perth Business College", tradingName: "Perth Business", rtoCode: "PBC004", cricosCode: "04567M" },
]

const SUPPLIER_ROUTES: Array<{
  qualificationCode: string
  rtoCode: string
  sourceAgentName: string
  wholesaleCost: number
}> = [
  { qualificationCode: "AUR32120", rtoCode: "MTC001", sourceAgentName: "Global Source Partners", wholesaleCost: 3500 },
  { qualificationCode: "AUR32120", rtoCode: "SIT002", sourceAgentName: "Global Source Partners", wholesaleCost: 3800 },
  { qualificationCode: "CPC30220", rtoCode: "MTC001", sourceAgentName: "Pacific RTO Network", wholesaleCost: 4200 },
  { qualificationCode: "CPC30220", rtoCode: "SIT002", sourceAgentName: "Pacific RTO Network", wholesaleCost: 4000 },
  { qualificationCode: "SIT30622", rtoCode: "BHA003", sourceAgentName: "Global Source Partners", wholesaleCost: 2800 },
  { qualificationCode: "SIT30622", rtoCode: "BHA003", sourceAgentName: "Pacific RTO Network", wholesaleCost: 2600 },
  { qualificationCode: "CHC33021", rtoCode: "PBC004", sourceAgentName: "Southern Cross Sales", wholesaleCost: 3200 },
  { qualificationCode: "CHC33021", rtoCode: "MTC001", sourceAgentName: "Pacific RTO Network", wholesaleCost: 3400 },
  { qualificationCode: "BSB30120", rtoCode: "PBC004", sourceAgentName: "Southern Cross Sales", wholesaleCost: 2200 },
  { qualificationCode: "UEE30820", rtoCode: "SIT002", sourceAgentName: "Global Source Partners", wholesaleCost: 4500 },
]

const USERS = [
  {
    email: "superadmin@skillsconnect.com.au",
    name: "Super Admin",
    password: "Admin123!",
    role: "SUPER_ADMIN",
    roleNames: ["SUPER_ADMIN"],
    agency_name: null,
    b2b_tier: "SILVER",
    default_commission_pct: 0,
  },
  {
    email: "admin@skillsconnect.com.au",
    name: "Admin User",
    password: "Admin123!",
    role: "ADMIN",
    roleNames: ["ADMIN"],
    agency_name: null,
    b2b_tier: "SILVER",
    default_commission_pct: 0,
  },
  {
    email: "bdc@skillsconnect.com.au",
    name: "BDC Agent",
    password: "Bdc123!",
    role: "BDC",
    roleNames: ["BDC"],
    agency_name: null,
    b2b_tier: "SILVER",
    default_commission_pct: 0,
  },
  {
    email: "b2bagent@skillsconnect.com.au",
    name: "B2B Partner Agent",
    password: "B2b123!",
    role: "B2B_AGENT",
    roleNames: ["B2B_AGENT"],
    agency_name: "Overseas Partners Pty Ltd",
    b2b_tier: "GOLD",
    default_commission_pct: 5,
  },
  {
    email: "employee@skillsconnect.com.au",
    name: "Staff Employee",
    password: "Emp123!",
    role: "EMPLOYEE",
    roleNames: ["EMPLOYEE"],
    agency_name: null,
    b2b_tier: "SILVER",
    default_commission_pct: 0,
  },
]

async function main() {
  // ---- Agents ----
  const agentColl = await collection("agents")
  const agentIds = new Map<string, string>()
  for (const a of AGENTS) {
    const contact = a.contact || generateDemoContact(a.name)
    const existing = await agentColl.findOne({ name: a.name, contact })
    if (existing) {
      agentIds.set(a.name, String(existing._id))
      continue
    }
    const res = await agentColl.insertOne({
      name: a.name,
      type: a.type,
      contact,
      commissionRule: a.commissionRule,
      active: true,
      createdAt: NOW,
      updatedAt: NOW,
    })
    agentIds.set(a.name, String(res.insertedId))
  }

  // ---- Qualifications ----
  const qualColl = await collection("qualifications")
  const qualIds = new Map<string, string>()
  for (const q of QUALIFICATIONS) {
    const existing = await qualColl.findOne({ code: q.code })
    if (existing) {
      qualIds.set(q.code, String(existing._id))
      continue
    }
    const res = await qualColl.insertOne({
      code: q.code,
      title: q.title,
      trainingPackage: q.trainingPackage,
      industry: q.industry,
      status: "current",
      licensingRefs: [],
      createdAt: NOW,
      updatedAt: NOW,
    })
    qualIds.set(q.code, String(res.insertedId))
  }

  // ---- RTOs ----
  const rtoColl = await collection("rtos")
  const rtoIds = new Map<string, string>()
  for (const r of RTOS) {
    const existing = await rtoColl.findOne({ rtoCode: r.rtoCode })
    if (existing) {
      rtoIds.set(r.rtoCode, String(existing._id))
      continue
    }
    const contacts = [
      { name: "RTO Agent", role: "agent", email: generateDemoContact(r.tradingName + " agent"), phone: "" },
      { name: "RTO Contact", role: "contact", email: generateDemoContact(r.tradingName), phone: "" },
    ]
    const res = await rtoColl.insertOne({
      legalName: r.legalName,
      tradingName: r.tradingName,
      rtoCode: r.rtoCode,
      cricosCode: r.cricosCode,
      contacts,
      status: "active",
      complianceNote: null,
      website: null,
      accreditationNumber: null,
      accreditationBody: null,
      accreditationExpiry: null,
      lastAuditDate: null,
      accreditationStatus: null,
      supportingDocumentIds: [],
      accreditationNotes: null,
      createdAt: NOW,
      updatedAt: NOW,
    })
    rtoIds.set(r.rtoCode, String(res.insertedId))
  }

  // ---- Qualification↔RTO mappings ----
  const mappingColl = await collection("qualification-rto-mappings")
  const mappedKeys = new Set<string>()
  for (const route of SUPPLIER_ROUTES) {
    const qId = qualIds.get(route.qualificationCode)
    const rId = rtoIds.get(route.rtoCode)
    if (!qId || !rId) continue
    const key = `${qId}|${rId}`
    if (mappedKeys.has(key)) continue
    mappedKeys.add(key)
    const existing = await mappingColl.findOne({ qualificationId: qId, rtoId: rId })
    if (!existing) {
      await mappingColl.insertOne({
        qualificationId: qId,
        rtoId: rId,
        status: "active",
        effectiveFrom: NOW.toISOString(),
        effectiveTo: null,
        createdAt: NOW,
        updatedAt: NOW,
      })
    }
  }

  // ---- Supplier routes ----
  const routeColl = await collection("supplier-routes")
  const routeKeys = new Set<string>()
  for (const route of SUPPLIER_ROUTES) {
    const qId = qualIds.get(route.qualificationCode)
    const rId = rtoIds.get(route.rtoCode)
    const aId = agentIds.get(route.sourceAgentName)
    if (!qId || !rId || !aId) continue
    const key = `${qId}|${rId}`
    if (routeKeys.has(key)) continue
    routeKeys.add(key)
    const existing = await routeColl.findOne({ qualificationId: qId, rtoId: rId })
    if (!existing) {
      await routeColl.insertOne({
        qualificationId: qId,
        sourceAgentId: aId,
        rtoId: rId,
        wholesaleCost: route.wholesaleCost,
        currency: "AUD",
        effectiveFrom: NOW.toISOString(),
        effectiveTo: null,
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
      })
    }
  }

  // ---- Users ----
  const userColl = await collection("users")
  for (const u of USERS) {
    const existing = await userColl.findOne({ email: u.email })
    if (existing) continue
    const { hash } = await hashPassword(u.password)
    await userColl.insertOne({
      email: u.email,
      name: u.name,
      full_name: u.name,
      phone: generateDemoContact(u.name),
      passwordHash: hash,
      role: u.role,
      roleNames: u.roleNames,
      agency_name: u.agency_name,
      b2b_tier: u.b2b_tier,
      default_commission_pct: u.default_commission_pct,
      active: true,
      is_active: true,
      createdAt: NOW,
      updatedAt: NOW,
      failedLoginCount: 0,
    })
  }

  console.log("✅ Master Hub seed complete")
  console.log(`   Agents: ${AGENTS.length}`)
  console.log(`   Qualifications: ${QUALIFICATIONS.length}`)
  console.log(`   RTOs: ${RTOS.length}`)
  console.log(`   Supplier routes: ${SUPPLIER_ROUTES.length}`)
  console.log(`   Users: ${USERS.length}`)
  console.log("")
  console.log("Demo login credentials:")
  for (const u of USERS) {
    console.log(`   ${u.email} / ${u.password}  (${u.role})`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
