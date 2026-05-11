import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import Machines from './pages/Machines'
import Containers from './pages/Containers'
import Deployments from './pages/Deployments'
import GitHub from './pages/GitHub'
import Cloudflare from './pages/Cloudflare'
import Settings from './pages/Settings'
import Topology from './pages/Topology'
import CiCd from './pages/CiCd'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="machines" element={<Machines />} />
            <Route path="containers" element={<Containers />} />
            <Route path="deployments" element={<Deployments />} />
            <Route path="topology" element={<Topology />} />
            <Route path="cicd" element={<CiCd />} />
            <Route path="github" element={<GitHub />} />
            <Route path="cloudflare" element={<Cloudflare />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
