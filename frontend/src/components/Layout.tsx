import { useState, useEffect } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import {
  LayoutDashboard, Server, Box, Rocket, GitFork, Globe,
  LogOut, ChevronLeft, ChevronRight, Menu, X, Zap, Settings, Network
} from 'lucide-react'

const NAV = [
  { to: '/',            label: 'Dashboard',   icon: LayoutDashboard, end: true },
  { to: '/machines',    label: 'Machines',    icon: Server },
  { to: '/containers',  label: 'Containers',  icon: Box },
  { to: '/deployments', label: 'Deployments', icon: Rocket },
  { to: '/topology',   label: 'Topology',    icon: Network },
  { to: '/github',      label: 'GitHub',      icon: GitFork },
  { to: '/cloudflare',  label: 'Cloudflare',  icon: Globe },
  { to: '/settings',    label: 'Settings',    icon: Settings },
]

function useCollapsed() {
  const [c, setC] = useState(() => {
    try { return localStorage.getItem('ac-sidebar') === '1' } catch { return false }
  })
  const toggle = () => setC(v => { const next = !v; try { localStorage.setItem('ac-sidebar', next ? '1' : '0') } catch {} return next })
  return [c, toggle] as const
}

export default function Layout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, toggleCollapsed] = useCollapsed()
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  const handleLogout = () => { logout(); navigate('/login') }

  const currentPage = NAV.find(n => n.end ? location.pathname === n.to : location.pathname.startsWith(n.to))?.label ?? 'AutomationCenter'

  const Sidebar = ({ mobile = false }: { mobile?: boolean }) => (
    <aside
      style={{ width: mobile ? '240px' : collapsed ? '64px' : '240px' }}
      className={`flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-250 ease-out overflow-hidden shrink-0 ${mobile ? 'h-full' : 'h-screen sticky top-0'}`}
    >
      {/* Logo row */}
      <div className="flex items-center justify-between px-3 py-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <Zap size={15} className="text-primary-foreground" />
          </div>
          <span
            className="font-semibold text-sidebar-foreground text-sm leading-none transition-all duration-200 whitespace-nowrap"
            style={{ opacity: collapsed && !mobile ? 0 : 1, width: collapsed && !mobile ? 0 : 'auto', overflow: 'hidden' }}
          >
            AutomationCenter
          </span>
        </div>
        {!mobile && (
          <button
            onClick={toggleCollapsed}
            className="ml-auto p-1 rounded-md text-muted-foreground hover:text-sidebar-foreground hover:bg-white/5 transition-colors shrink-0"
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        )}
        {mobile && (
          <button onClick={() => setMobileOpen(false)} className="p-1 text-muted-foreground hover:text-foreground">
            <X size={16} />
          </button>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto overflow-x-hidden">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            title={collapsed && !mobile ? label : undefined}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <Icon size={17} className="shrink-0" />
            <span
              className="text-sm font-medium transition-all duration-200 whitespace-nowrap"
              style={{ opacity: collapsed && !mobile ? 0 : 1, width: collapsed && !mobile ? 0 : 'auto', overflow: 'hidden' }}
            >
              {label}
            </span>
          </NavLink>
        ))}
      </nav>

      {/* User / logout */}
      <div className="p-2 border-t border-sidebar-border">
        <div className={`flex items-center gap-2.5 px-3 py-2 overflow-hidden ${collapsed && !mobile ? 'justify-center' : ''}`}>
          <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-primary">
              {(user?.name ?? user?.email ?? '?')[0].toUpperCase()}
            </span>
          </div>
          <div
            className="flex-1 min-w-0 transition-all duration-200"
            style={{ opacity: collapsed && !mobile ? 0 : 1, width: collapsed && !mobile ? 0 : 'auto', overflow: 'hidden' }}
          >
            <p className="text-xs font-medium text-sidebar-foreground truncate">{user?.name ?? 'User'}</p>
            <p className="text-[10px] text-muted-foreground truncate">{user?.email}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          title={collapsed && !mobile ? 'Logout' : undefined}
          className="nav-item w-full mt-0.5"
        >
          <LogOut size={15} className="shrink-0" />
          <span
            className="text-sm transition-all duration-200 whitespace-nowrap"
            style={{ opacity: collapsed && !mobile ? 0 : 1, width: collapsed && !mobile ? 0 : 'auto', overflow: 'hidden' }}
          >
            Logout
          </span>
        </button>
      </div>
    </aside>
  )

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden md:flex">
        <Sidebar />
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setMobileOpen(false)} />
          <div className="fixed left-0 top-0 bottom-0 z-50 md:hidden flex">
            <Sidebar mobile />
          </div>
        </>
      )}

      {/* Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="h-14 border-b border-border flex items-center gap-3 px-5 shrink-0 bg-background/80 backdrop-blur-sm sticky top-0 z-10">
          <button
            onClick={() => setMobileOpen(true)}
            className="md:hidden p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Menu size={18} />
          </button>
          <h1 className="text-sm font-semibold text-foreground">{currentPage}</h1>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
