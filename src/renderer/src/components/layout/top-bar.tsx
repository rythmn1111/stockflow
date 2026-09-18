import { PlusIcon, SearchIcon, ArrowDownUpIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUiStore } from '@/store/ui'
import { useSettings } from '@/hooks/use-data'

export function TopBar(): React.JSX.Element {
  const { openPalette, openItemForm, openMoveForm } = useUiStore()
  const { data: settings } = useSettings()

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 drag-region">
      <div className="flex-1 truncate text-sm font-medium">
        {settings?.companyName ?? 'StockFlow'}
      </div>

      <Button variant="outline" size="sm" className="gap-1.5 no-drag" onClick={openPalette}>
        <SearchIcon className="size-3.5" />
        <span className="text-xs text-muted-foreground">Find</span>
        <kbd className="ml-1 rounded border bg-muted px-1 font-mono text-[10px]">⌘K</kbd>
      </Button>

      <Button variant="outline" size="sm" className="gap-1.5 no-drag" onClick={() => openMoveForm()}>
        <ArrowDownUpIcon className="size-3.5" />
        Record movement
      </Button>

      <Button size="sm" className="gap-1.5 no-drag" onClick={() => openItemForm()}>
        <PlusIcon className="size-3.5" />
        New item
      </Button>
    </header>
  )
}
