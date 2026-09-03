import { useState } from "react"
import Sidebar from "./components/Sidebar"
import RuleEditForm from "./components/RuleEditForm"
import SettingsPage from "./components/SettingsPage"
import AccountChartsPage from "./components/AccountChartsPage"
import AccountViewPage from "./components/AccountViewPage"
import MarketViewPage from "./components/MarketViewPage"
import PositionLogPage from "./components/PositionLogPage"
import AccountLogPage from "./components/AccountLogPage"

/**
 * App: a pure switcher. Owns only the sidebar nav (`active`) and the
 * shared RuleEditForm modal's state (`editingRow`) -- both are inherently
 * cross-page UI state, not any one page's data. Every page fetches and
 * computes its own data itself (usePositionLog/useMarketPositions/
 * useAccountView/useMainViewFor/the settings hooks all live inside the
 * page components and their own lib/ hooks now, not here -- see each
 * page's own doc-comment for which it calls), so App.jsx doesn't import
 * or know about any of that; it just renders exactly one page component
 * for whichever tab is `active`, plus the modal when a row is being
 * edited.
 */
export default function App() {
  const [active, setActive] = useState("mainview")
  const [editingRow, setEditingRow] = useState(null)

  return (
    <div className="flex h-screen w-screen bg-slate-100">
      <Sidebar active={active} onSelect={setActive} />

      <main className="flex-1 overflow-auto p-6">
        {active === "mainview" && <AccountViewPage onRowClick={setEditingRow} />}
        {active === "positionlog" && <PositionLogPage />}
        {active === "accountlog" && <AccountLogPage />}
        {active === "chart" && <AccountChartsPage />}
        {active === "marketview" && <MarketViewPage onRowClick={setEditingRow} />}
        {active === "settings" && <SettingsPage />}
      </main>

      {editingRow && (
        <RuleEditForm row={editingRow} onClose={() => setEditingRow(null)} onSaved={() => setEditingRow(null)} />
      )}
    </div>
  )
}
