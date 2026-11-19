import { api } from "@/lib/api";

/** Client-side access layer for the single server-authorised dashboard API. */

export interface DashboardFilters {
  from?: string;
  to?: string;
  period?: "week" | "month" | "quarter" | "year";
  status?: string;
  agentId?: string;
}

export interface DashboardKpi {
  id: string;
  label: string;
  caption: string;
  value: number | string | null;
  unit?: "count" | "money" | "percent";
  currency?: string;
}

export interface DashboardData {
  role: string;
  generatedAt: string;
  view: string;
  filters: {
    from: string | null;
    to: string | null;
    status: string | null;
    agentId: string | null;
  };
  scope: { scoped: boolean; clients: number; orders: number };
  availability: {
    finance: { available: boolean; reason?: string };
    commission: { available: boolean; reason?: string };
    charts: { available: boolean; reason?: string };
  };
  currencyTotals: Array<{
    currency: string;
    invoiced: number;
    collected: number;
    outstanding: number;
    overdue: number;
  }>;
  kpis: Record<string, DashboardKpi[]>;
  charts: {
    ordersOverTime: Array<{ month: string; count: number }>;
    revenueOverTime: Array<{ month: string; currency: string; amount: number }>;
    statusDistribution: Array<{ status: string; count: number }>;
    qualificationDistribution: Array<{ label: string; count: number }>;
    rtoProgress: Array<{ stage: string; count: number }>;
    agentPerformance: Array<{ id: string; name: string; responsibility: string; orders: number; completed: number }>;
    commissionTrend: Array<{ month: string; currency: string; amount: number }>;
  };
  tables: {
    clients: Array<{
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      status: string;
      orderCount: number;
      missingDocuments: number;
      qualification: string | null;
    }>;
    orders: Array<{
      id: string;
      client: string;
      qualification: string;
      rto: string;
      status: string;
      evidenceStatus: string | null;
      rtoSubmissionStatus: string | null;
      certificateStatus: string | null;
      createdAt: string | null;
      currency?: string;
      amount?: number;
    }>;
    invoices: Array<{
      id: string;
      invoiceNumber: string;
      client: string;
      status: string;
      dueDate: string | null;
      currency: string;
      total: number;
    }>;
    tasks: Array<{
      id: string;
      title: string;
      status: string;
      dueDate: string | null;
      orderId: string | null;
    }>;
  };
}

export interface DashboardResponse {
  data?: DashboardData;
  error?: { code: string; message: string };
}

export function dashboardQuery(filters: DashboardFilters): string {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.period) params.set("period", filters.period);
  if (filters.status) params.set("status", filters.status);
  if (filters.agentId) params.set("agentId", filters.agentId);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export async function getDashboardData(filters: DashboardFilters): Promise<DashboardData> {
  return api.get<DashboardData>(`/reports/dashboard${dashboardQuery(filters)}`);
}
