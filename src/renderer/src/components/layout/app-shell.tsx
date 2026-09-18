import { Outlet } from 'react-router-dom'
import { Sidebar } from './sidebar'
import { TopBar } from './top-bar'

export function AppShell(): React.JSX.Element {
  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
