import { useState } from 'react'
import PriceRounder from './pages/PriceRounder'
import Toast, { ToastData } from './components/Toast'

type Page = 'price-rounder'

const navItems: { id: Page; icon: string; label: string }[] = [
  { id: 'price-rounder', icon: '₺', label: 'Fiyat Yuvarlama' },
]

export default function App() {
  const [activePage, setActivePage] = useState<Page>('price-rounder')
  const [toasts, setToasts] = useState<ToastData[]>([])

  const addToast = (toast: Omit<ToastData, 'id'>) => {
    const id = Math.random().toString(36).slice(2)
    setToasts((prev) => [...prev, { ...toast, id }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500)
  }

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-mark">
            <div className="sidebar-logo-icon">🛍️</div>
            <div>
              <div className="sidebar-logo-text">Shopify Tools</div>
              <span className="sidebar-logo-sub">Mağaza Araçları</span>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section-label">Araçlar</div>
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`nav-item${activePage === item.id ? ' active' : ''}`}
              onClick={() => setActivePage(item.id)}
            >
              <span className="nav-item-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">v0.1.0 · Netlify Functions</div>
      </aside>

      {/* Main */}
      <main className="main-content">
        {activePage === 'price-rounder' && <PriceRounder addToast={addToast} />}
      </main>

      <Toast toasts={toasts} />
    </div>
  )
}
