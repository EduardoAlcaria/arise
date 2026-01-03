
/* ── Types ────────────────────────────────────────────────────────────── */

type OsKey = 'ubuntu' | 'debian' | 'alpine' | 'centos' | 'arch' | 'fedora' | 'rhel' | 'windows' | 'macos' | 'generic'
type StackKey = 'node' | 'python' | 'java' | 'go' | 'rust' | 'php' | 'ruby' | 'dotnet' | 'docker' | 'shell' | 'generic'

/* ── OS config ────────────────────────────────────────────────────────── */

const OS_CFG: Record<OsKey, { bg: string; fg: string; label: string; domain: string }> = {
  ubuntu:  { bg: '#E95420', fg: '#fff', label: 'UB',   domain: 'ubuntu.com' },
  debian:  { bg: '#A80030', fg: '#fff', label: 'DEB',  domain: 'debian.org' },
  alpine:  { bg: '#0D597F', fg: '#fff', label: 'ALP',  domain: 'alpinelinux.org' },
  centos:  { bg: '#002060', fg: '#93BEE9', label: 'CNT', domain: 'centos.org' },
  arch:    { bg: '#1793D1', fg: '#fff', label: 'ARC',  domain: 'archlinux.org' },
  fedora:  { bg: '#3C6EB4', fg: '#fff', label: 'FED',  domain: 'fedoraproject.org' },
  rhel:    { bg: '#CC0000', fg: '#fff', label: 'RHEL', domain: 'redhat.com' },
  windows: { bg: '#00ADEF', fg: '#fff', label: 'WIN',  domain: 'microsoft.com' },
  macos:   { bg: '#636366', fg: '#fff', label: 'MAC',  domain: 'apple.com' },
  generic: { bg: '#2D3748', fg: '#A0AEC0', label: 'SRV', domain: '' },
}

/* ── Stack config ─────────────────────────────────────────────────────── */

const STACK_CFG: Record<StackKey, { bg: string; fg: string; label: string; domain: string }> = {
  node:    { bg: '#3C873A', fg: '#fff',    label: 'JS',  domain: 'nodejs.org' },
  python:  { bg: '#3572A5', fg: '#FFD43B', label: 'PY',  domain: 'python.org' },
  java:    { bg: '#B07219', fg: '#fff',    label: 'JV',  domain: 'spring.io' },
  go:      { bg: '#00ADD8', fg: '#fff',    label: 'GO',  domain: 'go.dev' },
  rust:    { bg: '#DEA584', fg: '#1C1C1C', label: 'RS',  domain: 'rust-lang.org' },
  php:     { bg: '#777BB4', fg: '#fff',    label: 'PHP', domain: 'php.net' },
  ruby:    { bg: '#CC342D', fg: '#fff',    label: 'RB',  domain: 'ruby-lang.org' },
  dotnet:  { bg: '#512BD4', fg: '#fff',    label: '.N',  domain: 'dotnet.microsoft.com' },
  docker:  { bg: '#0DB7ED', fg: '#fff',    label: 'DK',  domain: 'docker.com' },
  shell:   { bg: '#4EAA25', fg: '#fff',    label: 'SH',  domain: '' },
  generic: { bg: '#2D3748', fg: '#A0AEC0', label: 'APP', domain: '' },
}

/* ── Detection helpers ────────────────────────────────────────────────── */

export function detectOs(name: string): OsKey {
  const n = (name ?? '').toLowerCase()
  if (n.includes('ubuntu')) return 'ubuntu'
  if (n.includes('debian')) return 'debian'
  if (n.includes('alpine')) return 'alpine'
  if (n.includes('centos')) return 'centos'
  if (n.includes('arch')) return 'arch'
  if (n.includes('fedora')) return 'fedora'
  if (n.includes('rhel') || n.includes('redhat')) return 'rhel'
  if (n.includes('windows') || n.includes('win')) return 'windows'
  if (n.includes('mac') || n.includes('darwin')) return 'macos'
  return 'generic'
}

export function detectStack(stack?: string | null): StackKey {
  const s = (stack ?? '').toLowerCase()
  if (s.includes('node') || s.includes('npm') || s.includes('javascript') || s.includes('typescript') || s.includes('next') || s.includes('react')) return 'node'
  if (s.includes('python') || s.includes('django') || s.includes('flask') || s.includes('fastapi')) return 'python'
  if (s.includes('java') || s.includes('spring') || s.includes('maven') || s.includes('gradle') || s.includes('kotlin')) return 'java'
  if (s.includes('golang') || s.includes('go ')) return 'go'
  if (s.includes('rust') || s.includes('cargo')) return 'rust'
  if (s.includes('php') || s.includes('laravel') || s.includes('symfony')) return 'php'
  if (s.includes('ruby') || s.includes('rails')) return 'ruby'
  if (s.includes('.net') || s.includes('dotnet') || s.includes('csharp') || s.includes('aspnet')) return 'dotnet'
  if (s.includes('docker') || s.includes('container')) return 'docker'
  if (s.includes('shell') || s.includes('bash') || s.includes('sh')) return 'shell'
  return 'generic'
}

/* ── Icon components ──────────────────────────────────────────────────── */

export function OsIcon({ name, size = 38 }: { name: string; size?: number }) {
  const cfg = OS_CFG[detectOs(name)]
  const radius = Math.round(size * 0.22)
  return (
    <div style={{ width: size, height: size, background: cfg.bg, borderRadius: radius, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ color: cfg.fg, fontSize: Math.max(8, size * 0.28), fontWeight: 700, letterSpacing: '0.04em', fontFamily: "'Fira Code', monospace" }}>
        {cfg.label}
      </span>
    </div>
  )
}

export function StackIcon({ stack, size = 28 }: { stack?: string | null; size?: number }) {
  const key = detectStack(stack)
  if (key === 'docker') return <DockerIcon size={size} />
  const cfg = STACK_CFG[key]
  const radius = Math.round(size * 0.2)
  return (
    <div style={{ width: size, height: size, background: cfg.bg, borderRadius: radius, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ color: cfg.fg, fontSize: Math.max(7, size * 0.3), fontWeight: 700, letterSpacing: '0.02em', fontFamily: "'Fira Code', monospace" }}>
        {cfg.label}
      </span>
    </div>
  )
}

export function StatusDot({ status }: { status: string }) {
  const online = status === 'ONLINE' || status === 'RUNNING' || status === 'SUCCESS' || status === 'active'
  const error  = status === 'ERROR'  || status === 'FAILED'
  /* hardcoded green — theme accent is now near-black in the Black theme */
  const color  = online ? 'oklch(0.78 0.16 155)' : error ? 'var(--color-destructive)' : 'var(--color-muted-foreground)'
  return (
    <span className="relative flex h-2 w-2">
      {online && <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ backgroundColor: color }} />}
      <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: color }} />
    </span>
  )
}

export function DockerIcon({ size = 22, className = '' }: { size?: number; className?: string }) {
  return (
    <div style={{ width: size, height: size, flexShrink: 0, overflow: 'hidden', borderRadius: Math.round(size * 0.2), background: '#0DB7ED22', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width={size * 0.82} height={size * 0.82} viewBox="0 0 24 24" fill="none" className={className}>
        <g fill="#0DB7ED">
          <rect x="1.5" y="12.5" width="3.5" height="3.5" rx="0.4"/>
          <rect x="6.5" y="12.5" width="3.5" height="3.5" rx="0.4"/>
          <rect x="11.5" y="12.5" width="3.5" height="3.5" rx="0.4"/>
          <rect x="6.5" y="7.5" width="3.5" height="3.5" rx="0.4"/>
          <rect x="11.5" y="7.5" width="3.5" height="3.5" rx="0.4"/>
          <rect x="11.5" y="2.5" width="3.5" height="3.5" rx="0.4"/>
          <path d="M22.5 11.5c-.5-3-2.5-4-4-4h-.5c-.3-1.5-1.2-2.5-2-3l-.5.5c.7.6 1.1 1.7 1 2.5H2c-.3 0-.5.2-.5.5v3.5c0 2.5 1 4 2.5 5 1.5 1 3.5 1.5 6 1.5 1.5 0 3-.2 4.2-.7 1-.4 1.8-1 2.3-1.8 1 0 1.8-.4 2.3-1.2.4-.7.7-1.6.7-1.8z"/>
        </g>
      </svg>
    </div>
  )
}

export function GitHubIcon({ size = 22, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
    </svg>
  )
}

export function CloudflareIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M16.312 15.27l.465-1.586a3.37 3.37 0 00-3.27-4.22 3.37 3.37 0 00-3.14 2.17l-.21.57-.59-.05a1.88 1.88 0 00-.2 3.75l6.66-.01a.59.59 0 00.57-.43l-.29.81z" fill="#F6821F"/>
      <path d="M17.07 13.17l-.13-.01a2.1 2.1 0 00-1.94-1.3 2.12 2.12 0 00-1.98 1.39l-.13.35-.37-.03a1.17 1.17 0 00-.13 2.33h4.45a.37.37 0 00.36-.27l-.13-.44z" fill="#FBAD41"/>
      <circle cx="12" cy="12" r="10" stroke="#F6821F" strokeWidth="1.2" fill="none"/>
    </svg>
  )
}
