import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

/**
 * The application menu doubles as the keyboard-shortcut surface: every entry that
 * navigates sends a `nav:goto` the renderer turns into a route.
 */
export function buildAppMenu(
  getWindow: () => BrowserWindow | null,
  broadcast: (channel: string, payload: unknown) => void
): Menu {
  const go = (page: string) => () => broadcast('nav:goto', { page })
  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { label: 'Settings…', accelerator: 'Cmd+,', click: go('settings') },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Item…', accelerator: 'CmdOrCtrl+N', click: go('new-item') },
        { label: 'New Order…', accelerator: 'CmdOrCtrl+Shift+O', click: go('new-order') },
        { label: 'Record Stock Movement…', accelerator: 'CmdOrCtrl+M', click: go('new-move') },
        { type: 'separator' },
        { label: 'Export Stock Register…', click: () => broadcast('nav:goto', { page: 'items' }) },
        { type: 'separator' },
        ...(isMac ? [] : ([{ label: 'Settings…', accelerator: 'Ctrl+,', click: go('settings') }] as MenuItemConstructorOptions[])),
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find Item…', accelerator: 'CmdOrCtrl+F', click: go('search') },
        { label: 'Quick Open…', accelerator: 'CmdOrCtrl+K', click: go('palette') }
      ]
    },
    {
      label: 'Go',
      submenu: [
        { label: 'Dashboard', accelerator: 'CmdOrCtrl+1', click: go('dashboard') },
        { label: 'Items', accelerator: 'CmdOrCtrl+2', click: go('items') },
        { label: 'Bill of Materials', accelerator: 'CmdOrCtrl+3', click: go('bom') },
        { label: 'Orders', accelerator: 'CmdOrCtrl+4', click: go('orders') },
        { label: 'Material Log', accelerator: 'CmdOrCtrl+5', click: go('ledger') },
        { label: 'Purchasing', accelerator: 'CmdOrCtrl+6', click: go('purchasing') },
        { label: 'Locations', accelerator: 'CmdOrCtrl+7', click: go('locations') },
        { label: 'Suppliers', accelerator: 'CmdOrCtrl+8', click: go('suppliers') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      role: 'window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ role: 'front' as const }] : [])]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Show Log File',
          click: () => {
            const win = getWindow()
            if (win) win.webContents.send('nav:goto', { page: 'settings' })
          }
        },
        { label: 'Learn More', click: () => void shell.openExternal('https://github.com') }
      ]
    }
  ]

  return Menu.buildFromTemplate(template)
}
