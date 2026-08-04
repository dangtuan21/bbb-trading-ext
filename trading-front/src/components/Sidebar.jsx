const NAV_ITEMS = [
  { id: "positionlog", label: "Position Log" },
  { id: "accountlog", label: "Account Log" },
]

export default function Sidebar({ active, onSelect }) {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-slate-900 text-slate-100">
      <div className="px-4 py-5">
        <h1 className="text-lg font-semibold tracking-tight">TastyFX Positions</h1>
        <p className="text-xs text-slate-400">bbb-trading-ext</p>
      </div>
      <nav className="flex flex-col gap-1 px-2">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className={`rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
              active === item.id
                ? "bg-indigo-600 text-white"
                : "text-slate-300 hover:bg-slate-800 hover:text-white"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  )
}

export { NAV_ITEMS }
