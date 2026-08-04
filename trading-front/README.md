# trading-front (tastyfx-only)

React + Tailwind dashboard for the `bbb-trading-ext` TastyFX Positions
Tracker. This is a standalone copy scoped to a single platform (tastyfx) --
it's not the same as `bbb-trading/trading-front`, which shows the combined
multi-platform view. Left sidebar (Position Log / Account Log), right panel
shows the corresponding table. Everything is computed client-side from a
single CSV -- no backend.

## Run it

```bash
npm install
npm run dev       # dev server with hot reload
npm run build     # production build -> dist/
npm run preview   # serve the production build locally
```

## Data source

The app fetches `public/data/positionlog.csv` at load time and derives
everything else from it in the browser (`src/lib/compute.js`):

- **Position Log** -- the CSV rows as-is.
- **Account Log** -- rolled up per Platform+AccountID+Symbol (Direction
  joined, Size/PositionPL summed).

To refresh the data: the TastyFX Positions Tracker extension writes to
`../ext-server/tastyfx-positions.csv` on every capture, and `ext-server.js`
mirrors that same write to this project's `public/data/positionlog.csv` --
just reload the page after a capture happens (every N minutes, per the
extension popup's "Write every" setting, or immediately via "Write Now").
It's still a snapshot viewer, not a live connection: nothing pushes updates
to an already-open tab, you have to reload it.

## Structure

```
src/
  App.jsx                 layout + view switching
  components/
    Sidebar.jsx            left nav
    DataTable.jsx           generic table (money formatting, empty state)
  lib/
    schema.js               PositionLog field list (keep in sync with ../ext-server/server.js)
    usePositionLog.js       fetch + parse the CSV (PapaParse)
    compute.js               AccountLog roll-up logic
public/
  data/positionlog.csv      the data source (mirrored from ext-server)
```

## Data caveat

The app displays whatever's in `positionlog.csv` as-is -- it doesn't
validate the source data. If a capture partially failed, you'll see
partial/empty rows here too; check the extension popup's status and the
`ext-server` console output first.
