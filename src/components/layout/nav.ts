import {
  Bell,
  Briefcase,
  Building2,
  Calendar,
  Cloud,
  ClipboardList,
  CreditCard,
  DollarSign,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Link,
  Plus,
  RefreshCw,
  ScrollText,
  Settings,
  ShieldCheck,
  Target,
  Tags,
  Upload,
  UserCog,
  UserRound,
  Users,
  Wallet,
  Workflow,
  type LucideIcon,
} from "lucide-react"

export interface NavItem {
  label: string
  icon: LucideIcon
  /** Route path (wired to routing in a later phase; Day-1 shell only). */
  href: string
  /** Legacy path(s) that 301-redirect to this item's href. */
  legacyFrom?: string[]
}

export interface NavSection {
  title: string
  items: NavItem[]
}

/**
 * Phase 5 sidebar: 9 grouped menus replacing the previous 4-section / 41-item
 * flat structure. Legacy paths 301-redirect to their new canonical href.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
    ],
  },
  {
    title: "Operations",
    items: [
      { label: "Candidates & Applications", icon: Users, href: "/candidates", legacyFrom: ["/clients"] },
      { label: "Enrolments", icon: ClipboardList, href: "/enrolments", legacyFrom: ["/orders"] },
      { label: "Documents", icon: FileText, href: "/documents" },
      { label: "Workflow", icon: Workflow, href: "/workflow" },
    ],
  },
  {
    title: "Provider Module",
    items: [
      { label: "Qualifications", icon: GraduationCap, href: "/provider/qualifications", legacyFrom: ["/qualifications"] },
      { label: "Qualification Scopes", icon: Target, href: "/provider/scopes", legacyFrom: ["/scopes"] },
      { label: "Enrolment Kits", icon: FileText, href: "/provider/enrolment-kits", legacyFrom: ["/enrolment-kits"] },
    ],
  },
  {
    title: "Provider Module",
    items: [
      { label: "RTO / RTO Partners", icon: Building2, href: "/provider/rtos", legacyFrom: ["/rtos"] },
      { label: "RPL Partners", icon: Users, href: "/provider/rpl-partners", legacyFrom: ["/rpl-partners"] },
    ],
  },
  {
    title: "Sales & Channels",
    items: [
      { label: "In-House Sales Team", icon: Briefcase, href: "/sales/agents", legacyFrom: ["/agents"] },
      { label: "External Agents", icon: UserRound, href: "/partner/external-agents" },
    ],
  },
  {
    title: "Pricing & Finance",
    items: [
      { label: "Pricing", icon: Tags, href: "/pricing/pricing", legacyFrom: ["/pricing"] },
      { label: "Price Categories", icon: CreditCard, href: "/pricing/categories", legacyFrom: ["/price-categories"] },
      { label: "Price Lists", icon: DollarSign, href: "/pricing/lists", legacyFrom: ["/price-lists"] },
      { label: "Additional Fees", icon: Plus, href: "/pricing/fees", legacyFrom: ["/additional-fees"] },
    ],
  },
  {
    title: "Pricing & Finance",
    items: [
      { label: "Finance", icon: Wallet, href: "/finance/finance", legacyFrom: ["/finance"] },
      { label: "Commission Rules", icon: UserRound, href: "/finance/commission-rules", legacyFrom: ["/commission-rules"] },
      { label: "Commission Records", icon: Calendar, href: "/finance/commission-records", legacyFrom: ["/commission-records"] },
      { label: "Commission Payouts", icon: Wallet, href: "/finance/commission-payouts", legacyFrom: ["/commission-payouts"] },
      { label: "BDC Commission Ledger", icon: DollarSign, href: "/finance/bdc-commission-ledger" },
    ],
  },
  {
    title: "Settings",
    items: [
      { label: "Reports", icon: ScrollText, href: "/settings/reports", legacyFrom: ["/reports"] },
      { label: "Audit", icon: Bell, href: "/settings/audit", legacyFrom: ["/audit"] },
      { label: "Users", icon: UserCog, href: "/settings/users", legacyFrom: ["/users"] },
      { label: "Roles", icon: ShieldCheck, href: "/settings/roles", legacyFrom: ["/roles"] },
      { label: "Settings", icon: Settings, href: "/settings/settings", legacyFrom: ["/settings"] },
      { label: "QuickBooks", icon: Cloud, href: "/settings/quickbooks", legacyFrom: ["/integrations/quickbooks"] },
      { label: "Reconciliation", icon: RefreshCw, href: "/settings/reconciliation", legacyFrom: ["/reconciliation"] },
    ],
  },
]
