# StockFlow

A desktop stock register and material planner for small manufacturers.

You keep a list of parts, describe what each product is made from, and record every
receipt and issue. StockFlow works out what you have, what is already promised to open
orders, and what you need to buy. Everything lives in a file on your own computer —
no cloud, no account.

Runs on **macOS** and **Windows** (Linux builds work too).

## Download

Windows builds are on the [releases page](../../releases):

- **`StockFlow-<version>-Setup.exe`** — installer; lets you choose the install directory,
  creates shortcuts, and can be uninstalled from Add/Remove Programs.
- **`StockFlow-<version>-Portable.exe`** — no install; run it from anywhere, including a
  USB stick. Data still goes to `%APPDATA%\StockFlow`.

Both are x64 and **unsigned**, so Windows SmartScreen will show
*"Windows protected your PC"* on first run — choose **More info → Run anyway**. Verify
the download against the SHA-256 published on the release if you want to be sure of the
bytes.

macOS builds are not published yet; build one locally with `bun run dist:mac`.

---

## Where it came from

StockFlow is a rebuild of a real stock-control spreadsheet — six sheets and a VBA macro,
used by a small manufacturer. The sheets became the modules:

| Workbook sheet | StockFlow |
| --- | --- |
| `Item_Master` | **Items** — every field, plus computed stock |
| `BOM_Master` | **Bill of Materials** — per product, and recursive |
| `Order_Received` | **Orders** — with a status that actually drives something |
| `Material_Log` | **Material Log** — the ledger, append-only |
| `Stock_Register` | *gone* — stock is computed, never stored |
| `Material_Planning` | *replaced* — plans are saved per order, and shortages group into **Purchasing** |

### The four problems it fixes

**1. Planning one order destroyed the last one.** The `ProcessOrder` macro began with
`wsPlan.Rows("2:" & wsPlan.Rows.Count).ClearContents` — it wiped the whole planning
sheet before writing. Only one order's plan could exist. Here each plan is saved against
its order, and re-planning marks the old one *superseded* rather than deleting it, so
"what did we think we needed last week?" is still answerable.

**2. Two orders could be promised the same part.** Both looked up the same
`Current_Stock`, so you could plan order 55 and order 56 against the same ten units and
nothing objected. StockFlow tracks what live plans have *committed*, and plans against
free stock — on hand minus other open orders' claims.

**3. Stock was 774 rows of `SUMIFS` over a duplicated item list.** `Stock_Register`
repeated every code from `Item_Master` and kept them in step by hand. Here stock is a
SQL view over the ledger: the list cannot drift because there is only one list.

**4. Nothing was validated.** An item code with a typo became a log row that silently
affected nothing. A negative quantity inverted the arithmetic. Going below zero passed
without comment. Now the item is chosen from the master, quantity must be positive, and
the resulting balance is shown *before* you save.

---

## What it does

**Items**
- Raw materials and finished goods: code, name, unit, opening stock, reorder level,
  net and gross weight, packing box details, quantity per box, shelf location, supplier.
- Stock shown three ways — on hand, committed, free — with the arithmetic in the tooltip.
- Filter by stock condition: below reorder, negative, zero, or no reorder level set.
- A reorder level of `0` means *not configured*, not "warn me at nothing left".

**Bill of materials**
- Components per finished good, with an optional scrap allowance per line.
- **Recursive**: a sub-assembly is followed through to its own parts. The workbook's
  one-level `VLOOKUP` could not do this.
- Loops are refused, and the offending path is named: `TOP-01 → SUB-01 → RM-LEAF`.
- A live preview shows what an order for *N* would actually consume.

**Orders and planning**
- Plan an order to explode its bill of materials, check free stock, and get a shortage
  per component. Every run is kept.
- **Issue all available** writes the outward ledger entries in one click — the nine rows
  that used to be typed into `Material_Log` by hand, with the order number remembered in
  the Remarks column.
- Partial issue is deliberate: a store that can cover eight of nine parts should release
  those eight.
- Book finished units into stock; the order completes itself and releases what it had
  reserved but never issued.

**Purchasing**
- Every shortage across every open plan, **grouped by supplier** and combined per part.
  Four orders needing the same bracket is one line and one phone call.
- Works backwards from the earliest order due date, minus the supplier's lead time, to
  say when to place the order — and flags it when that date has passed.

**Built on fields the workbook never read**
- `Quantity Packed` → carton counts. 50 units at 24 per box is *3 boxes (2 full + 2 loose)*.
- `Net Weight` / `Gross Weight` → shipping weight, and packaging weight as the difference.
- `Location` → **pick lists grouped by shelf**, in numeric order, so the store is walked
  once instead of criss-crossed. Plus a stock-by-location view for stock-taking.

**Your data**
- One SQLite file. A snapshot on first launch each day, with restore; the three most
  recent are always kept whatever the retention setting.
- CSV reports for the stock register, bill of materials, ledger, any order's plan, the
  pick list and the purchase list. Full JSON export.
- **Stock as of any date** — possible only because the ledger keeps a timestamp on every
  entry. A sheet of `SUMIFS` can only ever show today.

---

## Tech

| Layer | Choice |
| --- | --- |
| Shell | Electron 38, context-isolated, no node integration in the renderer |
| Build | electron-vite (Vite 8 / rolldown), Bun as the package manager |
| Language | TypeScript, strict |
| UI | React 19, Tailwind CSS v4, shadcn/ui, Radix, TanStack Query, Zustand |
| Storage | `node:sqlite` — no native modules, so nothing to rebuild per platform |

One runtime dependency (`@electron-toolkit/utils`). The renderer never touches Node; it
talks to the main process over a typed `contextBridge` API (`src/shared/api.ts`), and the
main process pushes change events back so every screen stays honest — stock is derived
from the ledger and commitments from plans, so one write ripples widely.

---

## Getting started

```bash
bun install
bun dev
```

To open it against the workbook's own scenario — nine raw materials, the AEH-01 assembly,
orders 55 and 56, both planned:

```bash
bun run seed:demo "$HOME/Library/Application Support/StockFlow"
```

## Scripts

| Command | What it does |
| --- | --- |
| `bun dev` | Run with hot reload |
| `bun run build` | Typecheck, then build main, preload and renderer |
| `bun run typecheck` | Typecheck the Node and web projects |
| `bun run smoke` | Every smoke suite |
| `bun run smoke:db` | Repositories, validation, derived views, deletion guards |
| `bun run smoke:planning` | Planning, issuing, purchasing, recursion, cycles, scrap |
| `bun run smoke:packing` | Cartons, weights, pick lists, locations |
| `bun run seed:demo <userDataPath>` | Load the workbook scenario into a database |
| `bun run dist:mac` | macOS `.dmg` + `.zip` for arm64 and x64 |
| `bun run dist:win` | Windows installer + portable `.exe` |

Native code is deliberately avoided, so a build machine needs no compiler toolchain —
and because nothing needs compiling, `dist:win` cross-builds from macOS without wine.
macOS artifacts still have to be built on macOS, since only that can sign them.

---

## Where things live

```
src/
  main/                 Electron main process
    db/                 SQLite: schema, migrations, one repository per table
    services/           planning, packing/picking, CSV reports, backups
    ipc/                every IPC handler
  preload/              the contextBridge surface — the only main↔renderer door
  renderer/src/
    components/ui/      shadcn primitives
    features/           item, movement, order and supplier forms; detail sheets
    pages/              dashboard, items, bom, orders, ledger, purchasing, locations, suppliers, settings
    hooks/              TanStack Query wrappers and live-update plumbing
  shared/               types and the IPC contract, imported by both sides
```

### Data locations

| Platform | Folder |
| --- | --- |
| macOS | `~/Library/Application Support/StockFlow` |
| Windows | `%APPDATA%\StockFlow` |

Inside it: `data/stockflow.db`, `backups/`, `logs/main.log`.

---

## Two rules worth knowing

**The ledger is the only truth.** No quantity is ever stored. `item_stock` and
`item_committed` are SQL views, so a figure on screen cannot disagree with the entries
behind it.

**Entries are voided, never deleted.** A mistake is struck through with a reason and
stays visible. A register whose history can be edited away is not a register — which is
also why an item with ledger entries refuses to be deleted and asks to be archived.

## Notes and limits

- `freeStock` can go negative. That is the point: it is the aggregate shortage across
  open orders, and it is what the purchase list is built from.
- Negative *on-hand* stock is blocked by default, since issuing what you do not have is
  reporting fiction. It can be allowed for shops that log receipts after the fact.
- There is no multi-user mode. Two copies writing one SQLite file is how a stock register
  loses entries, so a second launch focuses the first window instead.
