import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"

import { AuthProvider } from "@/lib/auth"
import { AppShell } from "@/components/layout/app-shell"
import { RequireAuth, RequirePermission } from "@/components/require-auth"
import { Dashboard } from "@/components/dashboard/dashboard"
import { LoginPage } from "@/pages/login"
import { PlaceholderPage } from "@/pages/placeholder"
import { QualificationsPage } from "@/pages/qualifications"
import { RolesPage } from "@/pages/roles"
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
              <PlaceholderPage
                title="RTOs & Colleges"
                note="RTO directory and contacts land in D2-T5."
              />
            </RequirePermission>
          }
        />
        <Route
          path="agents"
          element={
            <RequirePermission perm="agents.manage">
              <PlaceholderPage
                title="Agents"
                note="Sales, certificate-source, and RTO-contact agents land in D2-T5."
              />
            </RequirePermission>
          }
        />
        <Route
          path="pricing"
          element={
            <RequirePermission perm="pricing.manage">
              <PlaceholderPage
                title="Supplier Pricing"
                note="Qualification → agent → RTO pricing matrix lands in D2-T5."
              />
            </RequirePermission>
          }
        />
        <Route
          path="clients"
          element={
            <PlaceholderPage title="Clients" note="Client management lands on Day 3." />
          }
        />
        <Route
          path="orders"
          element={
            <PlaceholderPage title="Orders" note="Order management lands on Day 3." />
          }
        />
        <Route
          path="documents"
          element={
            <PlaceholderPage title="Documents" note="Document workspace lands on Day 3." />
          }
        />
        <Route
          path="workflow"
          element={
            <PlaceholderPage title="Workflow" note="Workflow engine lands on Day 3." />
          }
        />
        <Route
          path="finance"
          element={
            <PlaceholderPage title="Finance" note="Invoices, plans, and payments land on Day 4." />
          }
        />
        <Route
          path="reports"
          element={
            <PlaceholderPage title="Reports" note="Reports land on Day 4." />
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
