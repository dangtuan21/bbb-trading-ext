import { useState } from "react"

const NAV_ITEMS = [
  { id: "mainview", label: "Main View" },
  { id: "positionlog", label: "Position Log" },
  { id: "accountlog", label: "Account Log" },
  { id: "settings", label: "Settings" },
]

// Drawer sidebar -- collapses to a narrow icon-rail (just each item's
// initial letter, full label on hover via title) and expands to the full
// labeled nav on toggle. Defaults to collapsed on load; no persistence, so
// it resets to collapsed on every page refresh.
export default function Sidebar({ active, onSelect }) {
  const [collapsed, setCollapsed] = useState(true)

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
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            title={collapsed ? item.label : undefined}
            className={`rounded-md py-2 text-left text-sm font-medium transition-colors ${
              collapsed ? "flex justify-center px-0" : "px-3"
            } ${
              active === item.id
                ? "bg-indigo-600 text-white"
                : "text-slate-300 hover:bg-slate-800 hover:text-white"
            }`}
          >
            {collapsed ? item.label.charAt(0) : item.label}
          </button>
        ))}
      </nav>
    </aside>
  )
}

export { NAV_ITEMS }
