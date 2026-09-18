import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

type Level = 'debug' | 'info' | 'warn' | 'error'

let logFile: string | null = null
const LEVEL_ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 }
const minLevel: Level = process.env.NODE_ENV === 'development' ? 'debug' : 'info'

export function initLogFile(userDataPath: string): void {
  logFile = join(userDataPath, 'logs', 'main.log')
  mkdirSync(dirname(logFile), { recursive: true })
}

function write(level: Level, scope: string, message: string): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`
  const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  consoleFn(line)
  if (logFile) {
    try {
      appendFileSync(logFile, line + '\n')
    } catch {
      // Never let logging break the app.
    }
  }
}

export const log = {
  debug: (scope: string, message: string) => write('debug', scope, message),
  info: (scope: string, message: string) => write('info', scope, message),
  warn: (scope: string, message: string) => write('warn', scope, message),
  error: (scope: string, message: string, err?: unknown) =>
    write('error', scope, err ? `${message}: ${errText(err)}` : message),
  getLogFile: () => logFile
}

export function errText(err: unknown): string {
  if (err instanceof Error) return err.stack ? `${err.message}\n${err.stack}` : err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}
