import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowDownUpIcon,
  BoxesIcon,
  ClipboardListIcon,
  FactoryIcon,
  MapPinIcon,
  PlusIcon,
  ScrollTextIcon,
  SettingsIcon,
  ShoppingCartIcon,
  TruckIcon
} from 'lucide-react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from '@/components/ui/command'
import { useItems, useOrders } from '@/hooks/use-data'
import { useUiStore } from '@/store/ui'
import { formatQty } from '@/lib/format'

/** Type-anywhere jump to any item, order or page. */
export function CommandPalette(): React.JSX.Element {
  const navigate = useNavigate()
  const { paletteOpen, openPalette, closePalette, openItemForm, openMoveForm, openOrderForm, setOpenItem } = useUiStore()
  const [search, setSearch] = useState('')

  // Search the master rather than only what is on screen, capped so a big master does
  // not make every keystroke expensive.
  const { data: itemsResult } = useItems({ search: search || undefined, scope: 'active', limit: 8, sort: 'code' })
  const { data: ordersResult } = useOrders({ search: search || undefined, limit: 6, sort: 'recent' })

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        paletteOpen ? closePalette() : openPalette()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paletteOpen, openPalette, closePalette])

  const run = (fn: () => void): void => {
    closePalette()
    setSearch('')
    fn()
  }

  return (
    <CommandDialog open={paletteOpen} onOpenChange={(open) => (open ? openPalette() : closePalette())}>
      <CommandInput placeholder="Search items and orders, or jump to a page…" value={search} onValueChange={setSearch} />
      <CommandList>
        <CommandEmpty>Nothing found.</CommandEmpty>

        {!!itemsResult?.items.length && (
          <CommandGroup heading="Items">
            {itemsResult.items.map((item) => (
              <CommandItem
                key={item.id}
                value={`item-${item.code}-${item.name}`}
                onSelect={() => run(() => {
                  navigate('/items')
                  setOpenItem(item.id)
                })}
              >
                <BoxesIcon className="size-3.5" />
                <span className="font-mono text-xs">{item.code}</span>
                <span className="truncate text-muted-foreground">{item.name}</span>
                <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatQty(item.currentStock, item.unit)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {!!ordersResult?.items.length && (
          <CommandGroup heading="Orders">
            {ordersResult.items.map((order) => (
              <CommandItem
                key={order.id}
                value={`order-${order.orderNo}-${order.fgCode}`}
                onSelect={() => run(() => navigate('/orders'))}
              >
                <ClipboardListIcon className="size-3.5" />
                <span className="font-mono text-xs">{order.orderNo}</span>
                <span className="truncate text-muted-foreground">
                  {order.fgCode} × {formatQty(order.qtyOrdered)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />

        <CommandGroup heading="Create">
          <CommandItem value="new item" onSelect={() => run(() => openItemForm())}>
            <PlusIcon className="size-3.5" />
            New item
          </CommandItem>
          <CommandItem value="new order" onSelect={() => run(() => openOrderForm())}>
            <PlusIcon className="size-3.5" />
            New order
          </CommandItem>
          <CommandItem value="record movement stock" onSelect={() => run(() => openMoveForm())}>
            <ArrowDownUpIcon className="size-3.5" />
            Record stock movement
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Go to">
          {[
            { label: 'Items', to: '/items', icon: BoxesIcon },
            { label: 'Bill of Materials', to: '/bom', icon: FactoryIcon },
            { label: 'Orders', to: '/orders', icon: ClipboardListIcon },
            { label: 'Material Log', to: '/ledger', icon: ScrollTextIcon },
            { label: 'Purchasing', to: '/purchasing', icon: ShoppingCartIcon },
            { label: 'Locations', to: '/locations', icon: MapPinIcon },
            { label: 'Suppliers', to: '/suppliers', icon: TruckIcon },
            { label: 'Settings', to: '/settings', icon: SettingsIcon }
          ].map((page) => (
            <CommandItem key={page.to} value={`go ${page.label}`} onSelect={() => run(() => navigate(page.to))}>
              <page.icon className="size-3.5" />
              {page.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
