import type { StockFlowApi } from '@shared/api'

declare global {
  interface Window {
    api: StockFlowApi & { theme: { set: (theme: 'light' | 'dark' | 'system') => void } }
  }
}
