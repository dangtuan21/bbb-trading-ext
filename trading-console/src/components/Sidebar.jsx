import { useState } from "react"

// `short` overrides the collapsed icon-rail's default first-letter, for any
// pair of labels that would otherwise collapse to the same letter with
// nothing to tell them apart until you hover: "Account View"/"Account Log"
// both start with "A", and "Market View" would otherwise match "Account
// View"'s old "Main View" wording's "M".
const NAV_ITEMS = [
  { id: "mainview", label: "Account View", short: "AV" },
  { id: "positionlog", label: "Position Log" },
  { id: "accountlog", label: "Account Log", short: "AL" },
  { id: "marketview", label: "Market View", short: "MV" },
  // Account Chart/Market Chart: each one page holding two stacked charts
  // (Daily DD Chart on top, Full Chart below it) -- see AccountChartsPage/
  // MarketChartsPage. `short` overrides since the default first letter "A"
  // would otherwise collide with "Account View"/"Account Log" above, and
  // "M" would collide with "Market View".
  { id: "chart", label: "Account Chart", short: "AC" },
  { id: "marketchart", label: "Market Chart", short: "MC" },
  { id: "settings", label: "Settings" },
]

// Drawer sidebar -- collapses to a narrow icon-rail (just each item's
// initial letter) and expands to the full labeled nav on toggle. Defaults
// to collapsed on load; no persistence, so it resets to collapsed on every
// page refresh.
//
// Collapsed, each icon also gets a custom hover tooltip showing the item's
// full name via `hoveredId` below -- richer-looking than a plain `title`
// attribute (still kept as a fallback for accessibility/screen readers),
// since "AV"/"AC"/"MC" etc. aren't self-explanatory on their own. Only
// shown collapsed: expanded mode already spells the label out in full.
export default function Sidebar({ active, onSelect }) {
  const [collapsed, setCollapsed] = useState(true)
  const [hoveredId, setHoveredId] = useState(null)

  return (
    <aside
      className={`flex shrink-0 flex-col border-r border-slate-200 bg-slate-900 text-slate-100 transition-[width] duration-200 ${
        collapsed ? "w-14" : "w-56"
      }`}
    >
      <div className={`flex items-center gap-2 px-2 py-5 ${collapsed ? "justify-center" : "justify-between px-4"}`}>
        {!collapsed && (
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">Trading Positions</h1>
          </div>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand menu" : "Collapse menu"}
          aria-label={collapsed ? "Expand menu" : "Collapse menu"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            {collapsed ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 5l-7 7 7 7" />
            )}
          </svg>
        </button>
      </div>
      <nav className="flex flex-col gap-1 px-2">
        {NAV_ITEMS.map((item) => (
          <div
            key={item.id}
            className="relative"
            onMouseEnter={() => setHoveredId(item.id)}
            onMouseLeave={() => setHoveredId((h) => (h === item.id ? null : h))}
          >
            <button
              type="button"
              onClick={() => onSelect(item.id)}
              title={collapsed ? item.label : undefined}
              className={`w-full rounded-md py-2 text-left text-sm font-medium transition-colors ${
                collapsed ? "flex justify-center px-0" : "px-3"
              } ${
                active === item.id
                  ? "bg-indigo-600 text-white"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`}
            >
              {collapsed ? item.short ?? item.label.charAt(0) : item.label}
            </button>
            {collapsed && hoveredId === item.id && (
              <div className="pointer-events-none absolute left-full top-1/2 z-20 ml-2 whitespace-nowrap rounded-md bg-slate-800 px-3 py-2 text-xs font-semibold text-white shadow-lg -translate-y-1/2">
                {item.label}
              </div>
            )}
          </div>
        ))}
      </nav>
    </aside>
  )
}

export { NAV_ITEMS }
