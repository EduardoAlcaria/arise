import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { login } from '../api/auth'
import { useAuthStore } from '../stores/authStore'
import { AlertCircle, Server, Box, Rocket, GitFork, Zap } from 'lucide-react'

const FEATURES = [
  { icon: Server,  text: 'SSH machine management & remote execution' },
  { icon: Box,     text: 'Docker container orchestration' },
  { icon: Rocket,  text: 'Automated deployments with rollback' },
  { icon: GitFork, text: 'GitHub repository & branch integration' },
]

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login: storeLogin, isAuthenticated } = useAuthStore()
  const navigate = useNavigate()

  if (isAuthenticated()) { navigate('/', { replace: true }); return null }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await login({ email, password })
      storeLogin(data.token, { email: data.email, name: data.name, role: data.role })
      navigate('/')
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Login failed. Check your credentials.')
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left — brand panel */}
      <div className="hidden lg:flex flex-1 relative overflow-hidden items-center justify-center p-16">
        <div className="absolute inset-0" style={{
          background: 'radial-gradient(ellipse at 20% 30%, oklch(0.6726 0.2904 341.4084 / 0.12) 0%, transparent 55%), radial-gradient(ellipse at 80% 70%, oklch(0.8903 0.1739 171.2690 / 0.07) 0%, transparent 50%)',
        }} />
        {/* Subtle grid */}
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: 'linear-gradient(var(--foreground) 1px, transparent 1px), linear-gradient(90deg, var(--foreground) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }} />

        <div className="relative z-10 max-w-sm animate-fade-up">
          <div className="flex items-center gap-3 mb-10">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <Zap size={18} className="text-primary-foreground" />
            </div>
            <span className="text-lg font-semibold text-foreground">AutomationCenter</span>
          </div>

          <h1 className="text-[2.4rem] font-bold text-foreground leading-[1.15] mb-4">
            Control your<br />
            infrastructure<br />
            <span className="text-primary">from one place.</span>
          </h1>
          <p className="text-muted-foreground mb-10 leading-relaxed">
            A unified dashboard to manage servers, containers, and CI/CD pipelines.
          </p>

          <div className="space-y-3 stagger">
            {FEATURES.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3 animate-fade-up">
                <div className="w-8 h-8 rounded-lg bg-muted border border-border flex items-center justify-center shrink-0">
                  <Icon size={13} className="text-primary" />
                </div>
                <span className="text-sm text-muted-foreground">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right — form */}
      <div className="flex-1 flex items-center justify-center p-8 lg:max-w-[420px]">
        <div className="w-full max-w-sm animate-fade-up">
          {/* Mobile logo */}
          <div className="flex items-center gap-2.5 mb-8 lg:hidden">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Zap size={15} className="text-primary-foreground" />
            </div>
            <span className="font-semibold text-foreground text-sm">AutomationCenter</span>
          </div>

          <h2 className="text-2xl font-bold text-foreground mb-1">Welcome back</h2>
          <p className="text-muted-foreground text-sm mb-7">Sign in to your account to continue</p>

          {error && (
            <div className="mb-5 p-3 rounded-lg flex items-center gap-2.5 text-sm text-destructive border border-destructive/20 bg-destructive/8">
              <AlertCircle size={14} className="shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Email address</label>
              <input className="input-field" type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Password</label>
              <input className="input-field" type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition-all mt-1"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            No account?{' '}
            <Link to="/register" className="text-primary hover:underline font-medium">Create one</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
