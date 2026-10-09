import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"

import { AuthProvider } from "@/lib/auth"
import { AppShell } from "@/components/layout/app-shell"
import { RequireAuth, RequirePermission } from "@/components/require-auth"
import { Dashboard } from "@/components/dashboard/dashboard"
import { AgentsPage } from "@/pages/agents"
import { ClientProfilePage } from "@/pages/client-profile"
import { ClientsPage } from "@/pages/clients"
import { DocumentsPage } from "@/pages/documents"
import { FinancePage } from "@/pages/finance"
import { LoginPage } from "@/pages/login"
import { OrderDetailPage } from "@/pages/order-detail"
import { OrdersPage } from "@/pages/orders"
import { PlaceholderPage } from "@/pages/placeholder"
import { PricingPage } from "@/pages/pricing"
import { QualificationsPage } from "@/pages/qualifications"
import { ReportsPage } from "@/pages/reports"
import { RolesPage } from "@/pages/roles"
import { RtosPage } from "@/pages/rtos"
import { TasksPage } from "@/pages/tasks"
import { UsersPage } from "@/pages/users"

function ShellRoutes() {
  return (
    <AppShell>
      <Routes>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route
          path="users"
          element={
            <RequirePermission perm="users.manage">
              <UsersPage />
            </RequirePermission>
          }
        />
        <Route
          path="roles"
          element={
            <RequirePermission perm="roles.manage">
              <RolesPage />
            </RequirePermission>
          }
        />
        <Route
          path="qualifications"
          element={
            <RequirePermission perm="qualifications.manage">
              <QualificationsPage />
            </RequirePermission>
          }
        />
        <Route
          path="rtos"
          element={
            <RequirePermission perm="rto.manage">
              <RtosPage />
            </RequirePermission>
          }
        />
        <Route
          path="agents"
          element={
            <RequirePermission perm="agents.manage">
              <AgentsPage />
            </RequirePermission>
          }
        />
        <Route
          path="pricing"
          element={
            <RequirePermission perm="pricing.manage">
              <PricingPage />
            </RequirePermission>
          }
        />
        <Route
          path="clients"
          element={
            <RequirePermission perm="clients.view">
              <ClientsPage />
            </RequirePermission>
          }
        />
        <Route
          path="clients/:id"
          element={
            <RequirePermission perm="clients.view">
              <ClientProfilePage />
            </RequirePermission>
          }
        />
        <Route
          path="orders"
          element={
            <RequirePermission perm="orders.view">
              <OrdersPage />
            </RequirePermission>
          }
        />
        <Route
          path="orders/:id"
          element={
            <RequirePermission perm="orders.view">
              <OrderDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path="documents"
          element={
            <RequirePermission perm="documents.view">
              <DocumentsPage />
            </RequirePermission>
          }
        />
        <Route
          path="workflow"
          element={
            <RequirePermission perm="orders.view">
              <TasksPage />
            </RequirePermission>
          }
        />
        <Route
          path="finance"
          element={
            <RequirePermission perm="finance.view">
              <FinancePage />
            </RequirePermission>
          }
        />
        <Route
          path="reports"
          element={
            <RequirePermission perm="reports.view">
              <ReportsPage />
            </RequirePermission>
          }
        />
        <Route
          path="audit"
          element={
            <PlaceholderPage title="Audit" note="Audit log viewer lands on Day 4." />
          }
        />
        <Route
          path="settings"
          element={
            <PlaceholderPage title="Settings" note="Settings land on Day 4." />
          }
        />
        <Route
          path="*"
          element={
            <PlaceholderPage title="Not found" note="This route does not exist." />
          }
        />
      </Routes>
    </AppShell>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/*"
            element={
              <RequireAuth>
                <ShellRoutes />
              </RequireAuth>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
