import { createRootRoute, Outlet } from '@tanstack/react-router'
import { AppShell } from '@/components/layout/AppShell'

export const rootRoute = createRootRoute({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
})
