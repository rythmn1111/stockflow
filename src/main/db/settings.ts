import type { AppSettings } from '@shared/types'
import { query, run, transaction } from './connection'

export const DEFAULT_SETTINGS: AppSettings = {
  companyName: null,
  companyAddress: null,
  defaultUnit: 'Nos.',
  // On by default: a stock register that lets you issue what you do not have is
  // reporting fiction. It can be turned off for shops that back-date their receipts.
  blockNegativeStock: true,
  warnOnOverIssue: true,
  defaultScrapPercent: 0,
  ledgerWindowDays: 90,
  autoBackupEnabled: true,
  backupRetentionDays: 30,
  theme: 'system',
  onboardingCompletedAt: null
}

export const settingsRepo = {
  getAll(): AppSettings {
    const rows = query<{ key: string; value: string }>('SELECT key, value FROM settings')
    const stored: Record<string, unknown> = {}
    for (const row of rows) {
      try {
        stored[row.key] = JSON.parse(row.value)
      } catch {
        stored[row.key] = row.value
      }
    }
    // Merge over defaults so a setting introduced by an update just works.
    return { ...DEFAULT_SETTINGS, ...stored } as AppSettings
  },

  update(patch: Partial<AppSettings>): AppSettings {
    return transaction(() => {
      for (const [key, value] of Object.entries(patch)) {
        if (!(key in DEFAULT_SETTINGS)) continue
        run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
          key,
          JSON.stringify(value ?? null)
        ])
      }
      return settingsRepo.getAll()
    })
  }
}
