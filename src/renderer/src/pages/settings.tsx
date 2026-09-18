import { useState } from 'react'
import { CalendarClockIcon, DatabaseIcon, DownloadIcon, FolderOpenIcon, HistoryIcon, SaveIcon } from 'lucide-react'
import type { AppSettings } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { qk } from '@/lib/query-keys'
import { formatDateTime, fromDateInput, formatQty } from '@/lib/format'
import { setTheme } from '@/hooks/use-theme'
import { useAppInfo, useAppMutation, useBackups, useSettings, useStockAsOf } from '@/hooks/use-data'

export function SettingsPage(): React.JSX.Element {
  const { data: settings } = useSettings()
  const { data: info } = useAppInfo()
  const { data: backups } = useBackups()
  const [asOfDate, setAsOfDate] = useState('')
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null)

  const asOf = fromDateInput(asOfDate)
  // End of the chosen day, so "as of the 25th" includes everything logged that day.
  const { data: asOfRows } = useStockAsOf(asOf != null ? asOf + 86_399_999 : null)

  const update = useAppMutation((patch: Partial<AppSettings>) => window.api.settings.update(patch), {
    invalidate: [qk.settings, qk.itemsRoot, qk.stats]
  })

  const createBackup = useAppMutation(() => window.api.backup.create(), {
    invalidate: [qk.backups],
    successMessage: 'Snapshot saved'
  })

  const restore = useAppMutation((path: string) => window.api.backup.restore(path), {
    invalidate: [qk.backups],
    onSuccess: () => setRestoreTarget(null)
  })

  if (!settings) return <div className="p-5" />

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]): void => {
    update.mutate({ [key]: value } as Partial<AppSettings>)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-5">
      {/* --------------------------- company --------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Company</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="company">Name</Label>
            <Input
              id="company"
              defaultValue={settings.companyName ?? ''}
              onBlur={(e) => e.target.value !== (settings.companyName ?? '') && set('companyName', e.target.value || null)}
              placeholder="Shree Hari Industries"
            />
            <p className="text-[11px] text-muted-foreground">Appears on every printed report.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="address">Address</Label>
            <Textarea
              id="address"
              rows={2}
              defaultValue={settings.companyAddress ?? ''}
              onBlur={(e) =>
                e.target.value !== (settings.companyAddress ?? '') && set('companyAddress', e.target.value || null)
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* --------------------------- stock rules --------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Stock rules</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingRow
            label="Block negative stock"
            hint="Refuses an outward entry that would leave less than nothing. Turn this off only if receipts are routinely logged after the issue."
          >
            <Switch checked={settings.blockNegativeStock} onCheckedChange={(v) => set('blockNegativeStock', v)} />
          </SettingRow>

          <Separator />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="defaultUnit">Default unit</Label>
              <Input
                id="defaultUnit"
                defaultValue={settings.defaultUnit}
                onBlur={(e) => e.target.value && e.target.value !== settings.defaultUnit && set('defaultUnit', e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">Pre-filled on every new item.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="scrap">Default scrap %</Label>
              <Input
                id="scrap"
                defaultValue={String(settings.defaultScrapPercent)}
                onBlur={(e) => {
                  const value = Number(e.target.value)
                  if (Number.isFinite(value) && value !== settings.defaultScrapPercent) set('defaultScrapPercent', value)
                }}
                inputMode="decimal"
              />
              <p className="text-[11px] text-muted-foreground">Applied to new bill-of-materials lines.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ------------------- stock as of a date: the ledger's payoff ------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <HistoryIcon className="size-3.5" />
            Stock as of a date
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Because the ledger keeps a date on every entry, the register can be rewound. A spreadsheet of SUMIFS can
            only ever show today.
          </p>
          <div className="flex items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="asOf">Date</Label>
              <Input id="asOf" type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="w-40" />
            </div>
            {asOfDate && (
              <Button variant="ghost" size="sm" onClick={() => setAsOfDate('')}>
                Clear
              </Button>
            )}
          </div>

          {asOfRows && asOfRows.length > 0 && (
            <div className="max-h-64 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-28 text-right">Stock</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {asOfRows.map((row) => (
                    <TableRow key={row.itemId}>
                      <TableCell className="font-mono text-xs">{row.code}</TableCell>
                      <TableCell className="max-w-48 truncate">{row.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatQty(row.stock, row.unit)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* --------------------------- backups --------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <DatabaseIcon className="size-3.5" />
            Backups
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingRow label="Automatic daily snapshot" hint="Taken once per day when the app starts.">
            <Switch checked={settings.autoBackupEnabled} onCheckedChange={(v) => set('autoBackupEnabled', v)} />
          </SettingRow>

          <div className="space-y-1.5">
            <Label htmlFor="retention">Keep snapshots for (days)</Label>
            <Input
              id="retention"
              className="w-24"
              defaultValue={String(settings.backupRetentionDays)}
              onBlur={(e) => {
                const value = Number(e.target.value)
                if (Number.isFinite(value) && value !== settings.backupRetentionDays) set('backupRetentionDays', value)
              }}
              inputMode="numeric"
            />
            <p className="text-[11px] text-muted-foreground">
              The three most recent are always kept, whatever their age.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => createBackup.mutate(undefined)}>
              <SaveIcon className="size-3.5" />
              Snapshot now
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void window.api.backup.revealFolder()}>
              <FolderOpenIcon className="size-3.5" />
              Show folder
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void window.api.backup.exportJson()}>
              <DownloadIcon className="size-3.5" />
              Export everything as JSON
            </Button>
          </div>

          {!!backups?.length && (
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {backups.map((backup) => (
                <div key={backup.path} className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-sm">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5">
                      <CalendarClockIcon className="size-3 text-muted-foreground" />
                      {formatDateTime(backup.createdAt)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{Math.round(backup.sizeBytes / 1024)} KB</p>
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setRestoreTarget(backup.path)}>
                    Restore
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* --------------------------- appearance + about --------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Appearance</CardTitle>
        </CardHeader>
        <CardContent>
          <SettingRow label="Theme" hint="Follows the system by default.">
            <Select
              value={settings.theme}
              onValueChange={(value) => {
                set('theme', value as AppSettings['theme'])
                setTheme(value as AppSettings['theme'])
              }}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">System</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
        </CardContent>
      </Card>

      {info && (
        <div className="space-y-1 rounded-lg border p-3 text-xs text-muted-foreground">
          <p>
            StockFlow {info.version} · {info.platform}
            {info.isPackaged ? '' : ' · development build'}
          </p>
          <button
            className="block max-w-full truncate text-left underline-offset-2 hover:underline"
            onClick={() => void window.api.app.showItemInFolder(info.dbPath)}
          >
            Database: {info.dbPath}
          </button>
          <button className="underline-offset-2 hover:underline" onClick={() => void window.api.app.revealLogs()}>
            Show log file
          </button>
        </div>
      )}

      <AlertDialog open={!!restoreTarget} onOpenChange={(open) => !open && setRestoreTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this snapshot?</AlertDialogTitle>
            <AlertDialogDescription>
              Everything currently in StockFlow — items, bills of materials, orders and the whole ledger — will be
              replaced by the snapshot. The app restarts to finish. Take a snapshot of the current state first if you
              might want it back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault()
                if (restoreTarget) restore.mutate(restoreTarget)
              }}
            >
              Restore and restart
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function SettingRow({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  )
}
