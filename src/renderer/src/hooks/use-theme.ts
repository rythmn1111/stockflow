import { useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types'

type Theme = AppSettings['theme']

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyClass(resolved: 'light' | 'dark'): void {
  document.documentElement.classList.toggle('dark', resolved === 'dark')
  document.documentElement.style.colorScheme = resolved
}

let currentTheme: Theme = 'system'
const listeners = new Set<() => void>()

export function setTheme(theme: Theme): void {
  currentTheme = theme
  applyClass(theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : theme)
  window.api.theme.set(theme)
  listeners.forEach((fn) => fn())
}

export function useTheme(): { theme: Theme; resolved: 'light' | 'dark'; setTheme: (t: Theme) => void } {
  const [, force] = useState(0)

  useEffect(() => {
    const listener = (): void => force((n) => n + 1)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => {
      if (currentTheme === 'system') {
        applyClass(systemPrefersDark() ? 'dark' : 'light')
        force((n) => n + 1)
      }
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  return {
    theme: currentTheme,
    resolved: currentTheme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : currentTheme,
    setTheme
  }
}
