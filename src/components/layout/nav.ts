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
}

export interface NavSection {
  title: string
  items: NavItem[]
}

/**
 * Admin navigation per Spec §18. Single source of truth for
 * desktop sidebar + mobile drawer (T6 fills the dashboard content).
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [{ label: "Dashboard", icon: LayoutDashboard, href: "/dashboard" }],
  },
  {
    title: "Management",
    items: [
      { label: "Clients", icon: Users, href: "/clients" },
      { label: "Orders", icon: ClipboardList, href: "/orders" },
      { label: "Qualifications", icon: GraduationCap, href: "/qualifications" },
      { label: "RTOs & Colleges", icon: Building2, href: "/rtos" },
      { label: "Agents", icon: Briefcase, href: "/agents" },
      { label: "Pricing", icon: Tags, href: "/pricing" },
      { label: "Price Categories", icon: CreditCard, href: "/price-categories" },
      { label: "Price Lists", icon: DollarSign, href: "/price-lists" },
      { label: "Additional Fees", icon: Plus, href: "/additional-fees" },
      { label: "Qualification ↔ RTO", icon: Link, href: "/qualification-rto-mappings" },
      { label: "Import Templates", icon: ClipboardList, href: "/excel/templates" },
    ],
  },
  {
    title: "Operations",
    items: [
      { label: "Documents", icon: FileText, href: "/documents" },
      { label: "Workflow", icon: Workflow, href: "/workflow" },
      { label: "Finance", icon: Wallet, href: "/finance" },
      { label: "Commission Rules", icon: UserRound, href: "/commission-rules" },
      { label: "Commission Records", icon: Calendar, href: "/commission-records" },
      { label: "Commission Payouts", icon: Wallet, href: "/commission-payouts" },
      { label: "RTO Processing", icon: FileText, href: "/rto-processing" },
      { label: "Reconciliation", icon: RefreshCw, href: "/reconciliation" },
      { label: "Excel Import", icon: Upload, href: "/excel/upload" },
    ],
  },
  {
    title: "System",
    items: [
      { label: "Reports", icon: ScrollText, href: "/reports" },
      { label: "Audit", icon: Bell, href: "/audit" },
      { label: "QuickBooks", icon: Cloud, href: "/integrations/quickbooks" },
      { label: "Users", icon: UserCog, href: "/users" },
      { label: "Roles", icon: ShieldCheck, href: "/roles" },
      { label: "Settings", icon: Settings, href: "/settings" },
    ],
  },
]
