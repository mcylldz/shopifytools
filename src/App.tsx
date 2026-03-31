import { useState } from 'react'
import PriceRounder from './pages/PriceRounder'
import ProductEnrichment from './pages/ProductEnrichment'
import ProductImport from './pages/ProductImport'
import VtonTool from './pages/VtonTool'
import PriceUpdate from './pages/PriceUpdate'
import Toast, { ToastData } from './components/Toast'

type Page = 'price-rounder' | 'product-enrichment' | 'product-import' | 'vton-tool' | 'price-update'

const navItems: { id: Page; icon: string; label: string }[] = [
  { id: 'price-rounder', icon: '₺', label: 'Fiyat Yuvarlama' },
  { id: 'product-enrichment', icon: '🧠', label: 'AI Enrichment' },
  { id: 'product-import', icon: '📦', label: 'Ürün Import' },
  { id: 'vton-tool', icon: '👗', label: 'Virtual Try-On' },
  { id: 'price-update', icon: '💰', label: 'Fiyat Güncelleme' },
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

        <div className="sidebar-footer">v0.2.0 · Netlify Functions</div>
      </aside>

      {/* Main */}
      <main className="main-content">
        {activePage === 'price-rounder' && <PriceRounder addToast={addToast} />}
        {activePage === 'product-enrichment' && <ProductEnrichment addToast={addToast} />}
        {activePage === 'product-import' && <ProductImport addToast={addToast} />}
        {activePage === 'vton-tool' && <VtonTool addToast={addToast} />}
        {activePage === 'price-update' && <PriceUpdate addToast={addToast} />}
      </main>

      <Toast toasts={toasts} />
    </div>
  )
}
