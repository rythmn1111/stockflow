import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import { AppShell } from '@/components/layout/app-shell'
import { CommandPalette } from '@/features/command-palette'
import { ItemFormDialog } from '@/features/item-form-dialog'
import { MoveFormDialog } from '@/features/move-form-dialog'
import { OrderFormDialog } from '@/features/order-form-dialog'
import { SupplierFormDialog } from '@/features/supplier-form-dialog'
import { OnboardingFlow } from '@/pages/onboarding'
import { DashboardPage } from '@/pages/dashboard'
import { ItemsPage } from '@/pages/items'
import { BomPage } from '@/pages/bom'
import { OrdersPage } from '@/pages/orders'
import { LedgerPage } from '@/pages/ledger'
import { PurchasingPage } from '@/pages/purchasing'
import { LocationsPage } from '@/pages/locations'
import { SuppliersPage } from '@/pages/suppliers'
import { SettingsPage } from '@/pages/settings'
import { useLiveUpdates, useSettings } from '@/hooks/use-data'
import { setTheme } from '@/hooks/use-theme'
import { useUiStore } from '@/store/ui'

function AppRoutes(): React.JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/items" element={<ItemsPage />} />
        <Route path="/bom" element={<BomPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/ledger" element={<LedgerPage />} />
        <Route path="/purchasing" element={<PurchasingPage />} />
        <Route path="/locations" element={<LocationsPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

/** Bridges main-process menu clicks into the router. */
function NavBridge(): null {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { openPalette, openItemForm, openMoveForm, openOrderForm, focusSearch, setOpenItem } = useUiStore()

  useEffect(() => {
    return window.api.on.navigate((event) => {
      switch (event.page) {
        case 'item':
          navigate('/items')
          setOpenItem(event.itemId)
          break
        case 'order':
          navigate('/orders')
          break
        case 'dashboard':
          navigate('/')
          break
        case 'items':
          navigate('/items')
          break
        case 'bom':
          navigate('/bom')
          break
        case 'orders':
          navigate('/orders')
          break
        case 'ledger':
          navigate('/ledger')
          break
        case 'purchasing':
          navigate('/purchasing')
          break
        case 'locations':
          navigate('/locations')
          break
        case 'suppliers':
          navigate('/suppliers')
          break
        case 'settings':
          navigate('/settings')
          break
        case 'new-item':
          openItemForm()
          break
        case 'new-order':
          openOrderForm()
          break
        case 'new-move':
          openMoveForm()
          break
        case 'palette':
          openPalette()
          break
        case 'search':
          navigate('/items')
          focusSearch()
          break
        default:
          void queryClient.invalidateQueries()
      }
    })
  }, [navigate, openItemForm, openMoveForm, openOrderForm, openPalette, focusSearch, setOpenItem, queryClient])

  return null
}

function BootSplash(): React.JSX.Element {
  return (
    <div className="flex h-screen flex-col gap-4 p-8">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  )
}

export default function App(): React.JSX.Element {
  useLiveUpdates()
  const { data: settings, isLoading } = useSettings()
  const [themeApplied, setThemeApplied] = useState(false)

  useEffect(() => {
    if (settings && !themeApplied) {
      setTheme(settings.theme)
      setThemeApplied(true)
    }
  }, [settings, themeApplied])

  return (
    <TooltipProvider>
      {isLoading || !settings ? (
        <BootSplash />
      ) : !settings.onboardingCompletedAt ? (
        <OnboardingFlow />
      ) : (
        <>
          <NavBridge />
          <AppRoutes />
          <CommandPalette />
          <ItemFormDialog />
          <MoveFormDialog />
          <OrderFormDialog />
          <SupplierFormDialog />
        </>
      )}
      <Toaster />
    </TooltipProvider>
  )
}
