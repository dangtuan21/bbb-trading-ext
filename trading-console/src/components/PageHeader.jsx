/**
 * PageHeader: the title + row-count/freshness line (once ready) or
 * loading/error message (while its data is still in flight) every data-
 * driven page renders for itself. Pulled out as a shared dumb component --
 * pure props in, markup out, no page-specific logic of its own -- so App.jsx
 * doesn't need to know what "ready" looks like for whichever page happens
 * to be active; each page owns its own title, status, and row count and
 * just hands them to this component.
 *
 * `status`/`error` are the page's own data-source status (e.g. Account
 * View/Position Log/Account Log/Account Chart all share positions.csv's
 * status; Market View has its own, from market-positions.csv). `sourceFile`
 * is shown in the "ready" line as a fallback, and in the "loading" line
 * always (e.g. "Loading data/positions.csv..."). `freshnessLabel` (the
 * relative-time string, e.g. "2m ago") takes over from `sourceFile` in the
 * ready line once there's an actual timestamp to show.
 *
 * `rowCount` (optional) prefixes the ready line as "N rows · ". Omitted by
 * AccountChartsPage, which shows two different section-level counts (Full
 * Chart vs Daily DD Chart) instead of one page-level number.
 */
export default function PageHeader({ title, status, error, sourceFile, freshnessLabel, rowCount }) {
  return (
    <>
      <header className="mb-4 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold text-slate-800">{title}</h2>
        {status === "ready" && (
          <span className="text-xs text-slate-400">
            {rowCount != null && `${rowCount} row${rowCount === 1 ? "" : "s"} · `}
            {freshnessLabel ?? sourceFile}
          </span>
        )}
      </header>

      {status === "loading" && <p className="text-sm text-slate-400">Loading {sourceFile}...</p>}

      {status === "error" && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load the CSV data: {error}
        </p>
      )}
    </>
  )
}
