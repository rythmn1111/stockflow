import { NavLink } from 'react-router-dom'
import {
  BoxesIcon,
  ClipboardListIcon,
  FactoryIcon,
  LayoutDashboardIcon,
  MapPinIcon,
  ScrollTextIcon,
  SettingsIcon,
  ShoppingCartIcon,
  TruckIcon
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useStats } from '@/hooks/use-data'

/**
 * Navigation mirrors the workbook's sheets, because that is the mental model the user
 * already has — Items, BOM, Orders, Material Log — with the two derived sheets replaced
 * by the things they were really for: Purchasing and Locations.
 */
export function Sidebar(): React.JSX.Element {
  const { data: stats } = useStats()

  const nav = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboardIcon, end: true },
    { to: '/items', label: 'Items', icon: BoxesIcon, badge: stats?.belowReorderCount, badgeTone: 'warning' as const },
    { to: '/bom', label: 'Bill of Materials', icon: FactoryIcon },
    { to: '/orders', label: 'Orders', icon: ClipboardListIcon, badge: stats?.openOrderCount },
    { to: '/ledger', label: 'Material Log', icon: ScrollTextIcon },
    {
      to: '/purchasing',
      label: 'Purchasing',
      icon: ShoppingCartIcon,
      badge: stats?.totalShortageLines,
      badgeTone: 'destructive' as const
    },
    { to: '/locations', label: 'Locations', icon: MapPinIcon },
    { to: '/suppliers', label: 'Suppliers', icon: TruckIcon }
  ]

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar">
      {/* Space for the traffic lights on macOS, where the title bar is hidden. */}
      <div className="h-12 shrink-0" />
      <nav className="flex-1 space-y-0.5 px-2">
        {nav.map((entry) => (
          <NavLink
            key={entry.to}
            to={entry.to}
            end={entry.end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                isActive
                  ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground'
              )
            }
          >
            <entry.icon className="size-4 shrink-0" />
            <span className="flex-1 truncate">{entry.label}</span>
            {!!entry.badge && entry.badge > 0 && (
              <Badge
                variant={entry.badgeTone === 'destructive' ? 'destructive' : entry.badgeTone === 'warning' ? 'warning' : 'muted'}
                className="h-4 min-w-4 justify-center px-1 text-[10px]"
              >
                {entry.badge > 99 ? '99+' : entry.badge}
              </Badge>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="p-2">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
              isActive
                ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground'
            )
          }
        >
          <SettingsIcon className="size-4" />
          Settings
        </NavLink>
      </div>
    </aside>
  )
}
