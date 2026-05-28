import React, { useState, useEffect, useRef } from 'react'
import { X, Eye, EyeOff, Search, GitBranch, Loader2, ChevronRight, ChevronLeft, Check, AlertTriangle, Lock, Rocket, Plus, Trash2, Layers, FolderOpen, KeyRound, Database, Cloud } from 'lucide-react'
import { saveGitHubToken, getRepos, getBranches, getRepoEnvVars, getAriseConfig } from '../api/github'
import type { AriseConfig } from '../api/github'
import { getInfisicalStatus, getInfisicalSecrets } from '../api/infisical'
import { getCloudflareStatus } from '../api/cloudflare'
import type { AppServiceItem, ConfigFileItem } from '../api/deployments'
import type { GitHubRepo, GitHubBranch } from '../types'
import type { Machine } from '../types'

const GH_API = 'https://api.github.com'

interface GHUser { login: string; avatar_url: string }
interface RepoSel {
  repo: GitHubRepo
  branch: string
  subfolder: string
  branches: GitHubBranch[]
  loadingBranches: boolean
}
export interface DeployItem {
  repoUrl: string; branch: string; name: string; machineId: number
  tunnelName?: string; tunnelHostname?: string; tunnelAppPort?: number
  configFiles?: ConfigFileItem[]
  webhookUrl?: string
}
export interface AppDeployPayload {
  name: string
  machineId: number
  services: AppServiceItem[]
  configFiles: ConfigFileItem[]
  tunnelName?: string
  tunnelHostname?: string
  tunnelAppPort?: number
  webhookUrl?: string
}

interface Props {
  isConnected: boolean
  initialUser?: GHUser | null
  machines: Machine[]
  onCancel: () => void
  onDeploy: (items: DeployItem[]) => Promise<void>
  onAppDeploy: (payload: AppDeployPayload) => Promise<void>
  isDeploying: boolean
  onPatValidated: (user: GHUser) => void
  initialRepoForDeploy?: { repo: GitHubRepo; branch: string }
}

export default function DeployRepoWizard({
  isConnected, initialUser = null, machines, onCancel, onDeploy, onAppDeploy, isDeploying, onPatValidated,
  initialRepoForDeploy,
}: Props) {
  const [step, setStep] = useState(isConnected ? 2 : 1)
  const [pat, setPat] = useState('')
  const [showPat, setShowPat] = useState(false)
  const [validating, setValidating] = useState(false)
  const [patError, setPatError] = useState('')
  const [ghUser, setGhUser] = useState<GHUser | null>(initialUser)

  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [repoSearch, setRepoSearch] = useState('')
  const [selections, setSelections] = useState<Map<string, RepoSel>>(new Map())

  const [mode, setMode] = useState<'single' | 'application'>('single')
  const [appName, setAppName] = useState('')
  const [machineId, setMachineId] = useState<number>(0)
  const [deployNames, setDeployNames] = useState<Map<string, string>>(new Map())
  const [configFiles, setConfigFiles] = useState<ConfigFileItem[]>([])
  const [deployError, setDeployError] = useState('')
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [tunnelEnabled, setTunnelEnabled] = useState(false)
  const [tunnelName, setTunnelName] = useState('')
  const [tunnelHostname, setTunnelHostname] = useState('')
  const [tunnelAppPort, setTunnelAppPort] = useState(80)
  const [webhookUrl, setWebhookUrl] = useState('')

  const [ariseConfig, setAriseConfig] = useState<AriseConfig | null>(null)

  // Env vars state
  const [envVarKeys, setEnvVarKeys] = useState<string[]>([])
  const [envVars, setEnvVars] = useState<Record<string, string>>({})
  const [loadingEnvVars, setLoadingEnvVars] = useState(false)
  const [infisicalConnected, setInfisicalConnected] = useState(false)
  const [cloudflareConfigured, setCloudflareConfigured] = useState(false)
  const [infisicalModalOpen, setInfisicalModalOpen] = useState(false)
  const [infisicalEnv, setInfisicalEnv] = useState('dev')
  const [loadingInfisical, setLoadingInfisical] = useState(false)
  const [infisicalError, setInfisicalError] = useState('')

  useEffect(() => {
    if (isConnected) loadReposFromBackend()
    getInfisicalStatus().then(s => setInfisicalConnected(s.connected)).catch(() => {})
    getCloudflareStatus().then(s => setCloudflareConfigured(s.configured)).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-populate with initialRepoForDeploy
  useEffect(() => {
    if (initialRepoForDeploy && isConnected) {
      const { repo, branch } = initialRepoForDeploy
      const sel: RepoSel = { repo, branch, subfolder: repo.name, branches: [], loadingBranches: true }
      setSelections(new Map([[repo.fullName, sel]]))
      const [owner, repoName] = repo.fullName.split('/')
      getBranches(owner, repoName).then(branches => {
        setSelections(prev => {
          const next = new Map(prev)
          const ex = next.get(repo.fullName)
          if (ex) next.set(repo.fullName, { ...ex, branches, loadingBranches: false })
          return next
        })
      }).catch(() => {
        setSelections(prev => {
          const next = new Map(prev)
          const ex = next.get(repo.fullName)
          if (ex) next.set(repo.fullName, { ...ex, loadingBranches: false })
          return next
        })
      })
      // Pre-load env vars for the initial repo
      loadEnvVarsForRepo(owner, repoName, branch)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadReposFromBackend = async () => {
    setLoadingRepos(true)
    try {
      const data = await getRepos()
      setRepos(data)
    } catch { setRepos([]) } finally { setLoadingRepos(false) }
  }

  const loadBranchesForRepo = async (repo: GitHubRepo): Promise<GitHubBranch[]> => {
    try {
      const [owner] = repo.fullName.split('/')
      return await getBranches(owner, repo.name)
    } catch { return [] }
  }

  const loadEnvVarsForRepo = async (owner: string, repo: string, branch: string) => {
    setLoadingEnvVars(true)
    try {
      const result = await getRepoEnvVars(owner, repo, branch)
      setEnvVarKeys(result.vars ?? [])
      setEnvVars(prev => {
        const next: Record<string, string> = {}
        for (const k of result.vars ?? []) {
          next[k] = prev[k] ?? ''
        }
        return next
      })
    } catch {
      setEnvVarKeys([])
    } finally {
      setLoadingEnvVars(false)
    }
  }

  const loadAriseConfigForRepo = async (owner: string, repo: string, branch: string, applyBranch = true) => {
    const config = await getAriseConfig(owner, repo, branch)
    setAriseConfig(config)
    if (config?.branch && applyBranch && config.branch !== branch) {
      const ariseBranch = config.branch
      setSelections(prev => {
        const next = new Map(prev)
        const sel = next.get(`${owner}/${repo}`)
        if (sel) next.set(`${owner}/${repo}`, { ...sel, branch: ariseBranch })
        return next
      })
      loadEnvVarsForRepo(owner, repo, ariseBranch)
    }
    if (config?.env && config.env.length > 0) {
      setEnvVarKeys(prev => [...config.env!, ...prev.filter(k => !config.env!.includes(k))])
      setEnvVars(prev => {
        const next: Record<string, string> = { ...prev }
        for (const k of config.env!) { if (!(k in next)) next[k] = '' }
        return next
      })
    }
    if (config?.name) {
      setSelections(prev => {
        const entries = Array.from(prev.entries())
        if (entries.length === 1) {
          const [key, sel] = entries[0]
          setDeployNames(new Map([[key, config.name!]]))
        }
        return prev
      })
    }
    if (config?.port != null) {
      setTunnelAppPort(config.port)
    }
  }

  const validatePat = async () => {
    if (!pat.trim()) return
    setValidating(true); setPatError('')
    try {
      const res = await fetch(`${GH_API}/user`, {
        headers: { Authorization: `Bearer ${pat.trim()}`, Accept: 'application/vnd.github.v3+json' },
      })
      if (!res.ok) throw new Error('Invalid token or insufficient permissions')
      const user: GHUser = await res.json()
      await saveGitHubToken(pat.trim())
      setGhUser(user)
      onPatValidated(user)
      await loadReposFromBackend()
      setStep(2)
    } catch (e: any) {
      setPatError(e.message || 'Could not validate token')
    } finally { setValidating(false) }
  }

  const toggleRepo = (repo: GitHubRepo) => {
    setSelections(prev => {
      const next = new Map(prev)
      if (next.has(repo.fullName)) {
        next.delete(repo.fullName)
        // Clear env vars + arise config if in single mode and no other selection
        if (mode === 'single') {
          setEnvVarKeys([])
          setEnvVars({})
          setAriseConfig(null)
        }
      } else {
        next.set(repo.fullName, {
          repo, branch: repo.defaultBranch, subfolder: repo.name,
          branches: [], loadingBranches: true,
        })
        loadBranchesForRepo(repo).then(branches => {
          setSelections(p => {
            const n = new Map(p)
            const ex = n.get(repo.fullName)
            if (ex) n.set(repo.fullName, { ...ex, branches, loadingBranches: false })
            return n
          })
        })
        // Load env vars + arise config for single mode
        if (mode === 'single') {
          const [owner] = repo.fullName.split('/')
          loadEnvVarsForRepo(owner, repo.name, repo.defaultBranch)
          loadAriseConfigForRepo(owner, repo.name, repo.defaultBranch)
        }
      }
      return next
    })
  }

  const handleBranchChange = (repoFullName: string, branch: string) => {
    setSelections(prev => {
      const next = new Map(prev)
      const ex = next.get(repoFullName)
      if (ex) next.set(repoFullName, { ...ex, branch })
      return next
    })
    // Reload env vars + arise config on branch change (single mode)
    if (mode === 'single') {
      const parts = repoFullName.split('/')
      loadEnvVarsForRepo(parts[0], parts[1], branch)
      loadAriseConfigForRepo(parts[0], parts[1], branch, false)
    }
  }

  const proceedToStep3 = () => {
    if (selections.size === 0) return
    const names = new Map<string, string>()
    selections.forEach((sel, key) => names.set(key, sel.repo.name))
    setDeployNames(names)
    if (mode === 'application' && !appName) {
      setAppName(Array.from(selections.values())[0]?.repo.name ?? 'my-app')
    }
    setStep(3)
  }

  const buildEnvFileConfigItem = (): ConfigFileItem | null => {
    if (envVarKeys.length === 0) return null
    const lines = envVarKeys.map(k => `${k}=${envVars[k] ?? ''}`).join('\n')
    return { path: '.env', content: lines }
  }

  const handleDeploy = async () => {
    if (!machineId) { setDeployError('Please select a machine'); return }
    setDeployError('')
    const envFile = buildEnvFileConfigItem()
    if (mode === 'single') {
      const tunnelFields = tunnelEnabled && tunnelName.trim() && tunnelHostname.trim()
        ? { tunnelName: tunnelName.trim(), tunnelHostname: tunnelHostname.trim(), tunnelAppPort }
        : {}
      const allConfigs = [...(envFile ? [envFile] : []), ...configFiles]
      const items: DeployItem[] = Array.from(selections.values()).map(sel => ({
        repoUrl: sel.repo.url,
        branch: sel.branch,
        name: deployNames.get(sel.repo.fullName) || sel.repo.name,
        machineId,
        ...tunnelFields,
        configFiles: allConfigs.length > 0 ? allConfigs : undefined,
        webhookUrl: webhookUrl.trim() || undefined,
      }))
      try { await onDeploy(items) } catch (e: any) { setDeployError(e.message || 'Deployment failed') }
    } else {
      if (!appName.trim()) { setDeployError('Please enter an application name'); return }
      const allConfigFiles = envFile ? [...configFiles, envFile] : configFiles
      const payload: AppDeployPayload = {
        name: appName.trim(),
        machineId,
        services: Array.from(selections.values()).map(sel => ({
          name: sel.subfolder,
          repoUrl: sel.repo.url,
          branch: sel.branch,
        })),
        configFiles: allConfigFiles,
        ...(tunnelEnabled && tunnelName.trim() && tunnelHostname.trim() && {
          tunnelName: tunnelName.trim(),
          tunnelHostname: tunnelHostname.trim(),
          tunnelAppPort,
        }),
        webhookUrl: webhookUrl.trim() || undefined,
      }
      try { await onAppDeploy(payload) } catch (e: any) { setDeployError(e.message || 'Deployment failed') }
    }
  }

  const addConfigFile = () => setConfigFiles(prev => [...prev, { path: '', content: '' }])
  const removeConfigFile = (i: number) => setConfigFiles(prev => prev.filter((_, idx) => idx !== i))
  const updateConfigFile = (i: number, field: keyof ConfigFileItem, value: string) =>
    setConfigFiles(prev => prev.map((f, idx) => idx === i ? { ...f, [field]: value } : f))

  const SKIP_NAMES = new Set(['.DS_Store', 'Thumbs.db', '.git', 'node_modules', '__pycache__'])
  const handleFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    const added: ConfigFileItem[] = []
    for (const file of Array.from(files)) {
      const parts = file.webkitRelativePath.split('/')
      if (parts.some(p => SKIP_NAMES.has(p))) continue
      const relativePath = parts.slice(1).join('/')
      if (!relativePath) continue
      try {
        const content = await file.text()
        added.push({ path: relativePath, content })
      } catch { /* skip unreadable/binary files */ }
    }
    setConfigFiles(prev => [...prev, ...added])
    if (folderInputRef.current) folderInputRef.current.value = ''
  }

  const handleLoadFromInfisical = async () => {
    setLoadingInfisical(true)
    setInfisicalError('')
    try {
      const secrets = await getInfisicalSecrets(infisicalEnv)
      setEnvVars(prev => {
        const next = { ...prev }
        for (const s of secrets) {
          if (envVarKeys.includes(s.secretName)) {
            next[s.secretName] = s.secretValue
          }
        }
        return next
      })
      setInfisicalModalOpen(false)
    } catch (e: any) {
      setInfisicalError(e.message || 'Failed to load secrets')
    } finally {
      setLoadingInfisical(false)
    }
  }

  const filteredRepos = repos.filter(r => r.fullName.toLowerCase().includes(repoSearch.toLowerCase()))

  const modalWidth = step === 2 ? 580 : mode === 'application' ? 600 : 560

  return (
    <div onClick={onCancel} className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div
        onClick={e => e.stopPropagation()}
        className="bg-card border border-border rounded-2xl shadow-2xl animate-fade-up flex flex-col"
        style={{ width: modalWidth, maxWidth: 'calc(100vw - 32px)', maxHeight: '90vh' }}
      >
        {/* Step indicator header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            {[1, 2, 3].map(s => (
              <React.Fragment key={s}>
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-all"
                  style={{
                    background: step > s ? 'oklch(0.78 0.16 155)' : step === s ? 'var(--color-primary)' : 'var(--color-muted)',
                    color: step > s ? 'oklch(0 0 0)' : 'var(--color-primary-foreground)',
                  }}
                >
                  {step > s ? <Check size={11} /> : s}
                </div>
                {s < 3 && (
                  <div className="w-5 h-px transition-colors"
                    style={{ background: step > s ? 'oklch(0.78 0.16 155 / 0.4)' : 'var(--color-border)' }} />
                )}
              </React.Fragment>
            ))}
          </div>
          <span className="text-[12px] text-muted-foreground font-medium">
            {step === 1 ? 'Connect GitHub' : step === 2 ? 'Pick repositories' : 'Configure & deploy'}
          </span>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground transition-colors p-0.5">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">

          {/* ── Step 1: GitHub PAT ── */}
          {step === 1 && (
            <div>
              <div className="flex gap-3 items-start mb-4">
                <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center shrink-0">
                  <Lock size={16} className="text-foreground" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground mb-1">Connect to GitHub</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Enter a Personal Access Token with{' '}
                    <code className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded border border-border">repo</code>
                    {' '}scope. It will be saved securely in the database.
                  </p>
                </div>
              </div>
              <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">GitHub PAT</label>
              <div className="relative mb-3.5">
                <input
                  type={showPat ? 'text' : 'password'}
                  value={pat}
                  onChange={e => setPat(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && pat.trim() && validatePat()}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  autoFocus
                  className="input-field mono pr-10"
                />
                <button type="button" onClick={() => setShowPat(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                  {showPat ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {patError && (
                <div className="flex gap-2 items-start rounded-lg px-3 py-2 mb-3.5 text-xs text-destructive border border-destructive/20 bg-destructive/5">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" />{patError}
                </div>
              )}
              <p className="text-xs text-muted-foreground mb-5 leading-relaxed">
                <a href="https://github.com/settings/tokens/new" target="_blank" rel="noreferrer"
                  className="underline underline-offset-2 hover:text-foreground transition-colors">Create a token</a>
                {' '}— needs <code className="font-mono text-[11px]">repo</code> scope for private repos.
              </p>
              <button onClick={validatePat} disabled={!pat.trim() || validating}
                className="w-full py-2.5 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
                {validating
                  ? <><Loader2 size={14} className="animate-spin" />Validating & saving…</>
                  : <>Continue <ChevronRight size={14} /></>}
              </button>
            </div>
          )}

          {/* ── Step 2: Pick repos + mode ── */}
          {step === 2 && (
            <div>
              {/* Mode toggle */}
              <div className="flex items-center gap-1 p-1 bg-muted rounded-lg mb-4">
                <button
                  onClick={() => setMode('single')}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-semibold transition-all"
                  style={{
                    background: mode === 'single' ? 'var(--color-card)' : 'transparent',
                    color: mode === 'single' ? 'var(--color-foreground)' : 'var(--color-muted-foreground)',
                    boxShadow: mode === 'single' ? '0 1px 3px rgba(0,0,0,0.15)' : 'none',
                  }}
                >
                  <Rocket size={12} /> Single Repo
                </button>
                <button
                  onClick={() => setMode('application')}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-semibold transition-all"
                  style={{
                    background: mode === 'application' ? 'var(--color-card)' : 'transparent',
                    color: mode === 'application' ? 'var(--color-foreground)' : 'var(--color-muted-foreground)',
                    boxShadow: mode === 'application' ? '0 1px 3px rgba(0,0,0,0.15)' : 'none',
                  }}
                >
                  <Layers size={12} /> Application
                </button>
              </div>

              {mode === 'application' && (
                <div className="mb-3 px-3 py-2 rounded-lg text-xs text-muted-foreground border border-border bg-muted/30 leading-relaxed">
                  Select multiple repos — each will be cloned to its own subfolder and orchestrated with <code className="font-mono">docker compose</code>.
                </div>
              )}

              {ghUser && (
                <div className="flex items-center gap-2.5 mb-3 px-3 py-2 bg-muted/50 rounded-lg">
                  <img src={ghUser.avatar_url} alt="" className="w-6 h-6 rounded-full" />
                  <span className="text-sm font-medium text-foreground">{ghUser.login}</span>
                  <span className="text-xs text-muted-foreground ml-auto">{repos.length} repos</span>
                </div>
              )}

              <div className="relative mb-3">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input type="text" value={repoSearch} onChange={e => setRepoSearch(e.target.value)}
                  placeholder="Search repositories…" autoFocus
                  className="input-field" style={{ paddingLeft: '32px' }} />
              </div>

              {selections.size > 0 && (
                <div className="flex items-center gap-1.5 mb-2.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-muted text-foreground">
                  <Check size={12} />
                  {selections.size} repo{selections.size !== 1 ? 's' : ''} selected
                </div>
              )}

              {loadingRepos ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground gap-2 text-sm">
                  <Loader2 size={16} className="animate-spin" /> Loading repositories…
                </div>
              ) : filteredRepos.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground">No repositories found</div>
              ) : (
                <div className="flex flex-col gap-0.5 overflow-y-auto" style={{ maxHeight: 320 }}>
                  {filteredRepos.map(repo => {
                    const sel = selections.get(repo.fullName)
                    const isSelected = !!sel
                    return (
                      <div key={repo.fullName}>
                        <button
                          onClick={() => toggleRepo(repo)}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border transition-all text-left"
                          style={{
                            background: isSelected ? 'oklch(1 0 0 / 0.04)' : 'transparent',
                            borderColor: isSelected ? 'var(--color-ring)' : 'var(--color-border)',
                          }}
                        >
                          <div className="w-4 h-4 rounded flex items-center justify-center shrink-0 border-2 transition-all"
                            style={{
                              borderColor: isSelected ? 'var(--color-foreground)' : 'var(--color-border)',
                              background: isSelected ? 'var(--color-foreground)' : 'transparent',
                            }}>
                            {isSelected && <Check size={10} style={{ color: 'var(--color-background)' }} />}
                          </div>
                          <GitBranch size={13} className="shrink-0 text-muted-foreground" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{repo.fullName}</p>
                            <p className="text-[11px] text-muted-foreground flex gap-2 mt-0.5">
                              {repo.private && <span className="text-amber-400">Private</span>}
                              <span>Default: {repo.defaultBranch}</span>
                            </p>
                          </div>
                        </button>

                        {isSelected && sel && (
                          <div className="pl-10 pr-3 pt-1 pb-2.5 flex flex-col gap-1.5">
                            <div className="flex items-center gap-2">
                              <GitBranch size={11} className="text-muted-foreground shrink-0" />
                              <span className="text-[11px] text-muted-foreground shrink-0 w-14">Branch:</span>
                              {sel.loadingBranches ? (
                                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                  <Loader2 size={11} className="animate-spin" /> Loading…
                                </div>
                              ) : (
                                <select
                                  className="input-field mono text-xs flex-1"
                                  style={{ paddingTop: '4px', paddingBottom: '4px', height: '28px' }}
                                  value={sel.branch}
                                  onChange={e => handleBranchChange(repo.fullName, e.target.value)}
                                >
                                  {sel.branches.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
                                  {sel.branches.length === 0 && <option value={sel.branch}>{sel.branch}</option>}
                                </select>
                              )}
                            </div>
                            {mode === 'application' && (
                              <div className="flex items-center gap-2">
                                <Layers size={11} className="text-muted-foreground shrink-0" />
                                <span className="text-[11px] text-muted-foreground shrink-0 w-14">Subfolder:</span>
                                <input
                                  className="input-field mono text-xs flex-1"
                                  style={{ paddingTop: '4px', paddingBottom: '4px', height: '28px' }}
                                  value={sel.subfolder}
                                  placeholder={repo.name}
                                  onChange={e => setSelections(prev => {
                                    const next = new Map(prev)
                                    const ex = next.get(repo.fullName)
                                    if (ex) next.set(repo.fullName, { ...ex, subfolder: e.target.value })
                                    return next
                                  })}
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Env vars section (single mode, when vars detected) */}
              {mode === 'single' && (
                loadingEnvVars ? (
                  <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 size={12} className="animate-spin" /> Detecting environment variables…
                  </div>
                ) : envVarKeys.length > 0 ? (
                  <div className="mt-4 border border-border rounded-lg p-3 bg-muted/10">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <KeyRound size={13} className="text-muted-foreground" />
                        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                          Environment Variables ({envVarKeys.length})
                        </span>
                      </div>
                      {infisicalConnected && (
                        <button
                          onClick={() => setInfisicalModalOpen(true)}
                          className="flex items-center gap-1.5 text-[11px] text-primary hover:opacity-80 transition-opacity font-semibold"
                        >
                          <Database size={11} /> Load from Infisical
                        </button>
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      {envVarKeys.map(key => (
                        <div key={key} className="flex items-center gap-2">
                          <code className="text-[11px] font-mono text-muted-foreground w-2/5 truncate shrink-0">{key}</code>
                          <input
                            className="input-field mono text-xs flex-1"
                            style={{ paddingTop: '4px', paddingBottom: '4px', height: '28px' }}
                            placeholder={`value for ${key}`}
                            value={envVars[key] ?? ''}
                            onChange={e => setEnvVars(prev => ({ ...prev, [key]: e.target.value }))}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null
              )}
            </div>
          )}

          {/* ── Step 3: Configure + Deploy (single mode) ── */}
          {step === 3 && mode === 'single' && (
            <div>
              <div className="mb-4">
                <label className="block text-[11px] font-semibold text-muted-foreground mb-2 uppercase tracking-widest">
                  Repositories ({selections.size})
                </label>
                <div className="flex flex-col gap-2">
                  {Array.from(selections.values()).map(sel => (
                    <div key={sel.repo.fullName} className="bg-muted/20 border border-border rounded-xl p-3.5">
                      <div className="flex items-center gap-2 mb-2.5">
                        <GitBranch size={12} className="text-muted-foreground shrink-0" />
                        <span className="text-xs font-semibold text-foreground flex-1 truncate">{sel.repo.fullName}</span>
                        <code className="text-[11px] text-muted-foreground font-mono shrink-0">:{sel.branch}</code>
                        <button
                          onClick={() => {
                            setSelections(p => { const n = new Map(p); n.delete(sel.repo.fullName); return n })
                            setDeployNames(p => { const n = new Map(p); n.delete(sel.repo.fullName); return n })
                          }}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                        ><X size={12} /></button>
                      </div>
                      <div>
                        <label className="block text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">Deployment name</label>
                        <input
                          className="input-field"
                          style={{ paddingTop: '6px', paddingBottom: '6px', fontSize: '12px' }}
                          value={deployNames.get(sel.repo.fullName) ?? sel.repo.name}
                          onChange={e => setDeployNames(p => new Map(p).set(sel.repo.fullName, e.target.value))}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mb-3.5">
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Machine *</label>
                <select className="input-field" value={machineId || ''} onChange={e => setMachineId(Number(e.target.value))}>
                  <option value="">Select machine…</option>
                  {machines.map(m => <option key={m.id} value={m.id}>{m.name} ({m.host})</option>)}
                </select>
              </div>

              {/* Env vars summary */}
              {envVarKeys.length > 0 && (
                <div className="mb-3.5 border border-border rounded-lg p-3 bg-muted/10">
                  <div className="flex items-center gap-2 mb-2">
                    <KeyRound size={12} className="text-muted-foreground" />
                    <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                      .env file ({envVarKeys.length} vars)
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    {envVarKeys.map(key => (
                      <div key={key} className="flex items-center gap-2">
                        <code className="text-[11px] font-mono text-muted-foreground w-2/5 truncate shrink-0">{key}</code>
                        <code className="text-[11px] font-mono text-foreground truncate flex-1">
                          {envVars[key] ? '••••••' : <span className="text-muted-foreground/50">(empty)</span>}
                        </code>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* .arise.yml info badges */}
              {ariseConfig && (ariseConfig.compose || ariseConfig.port != null) && (
                <div className="mb-3.5 flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">arise.yml</span>
                  {ariseConfig.compose && (
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-muted border border-border text-foreground">
                      compose: {ariseConfig.compose}
                    </span>
                  )}
                  {ariseConfig.port != null && (
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-muted border border-border text-foreground">
                      port: {ariseConfig.port}
                    </span>
                  )}
                </div>
              )}

              {/* Config files (single mode) */}
              <div className="mb-3.5">
                <input
                  ref={folderInputRef}
                  type="file"
                  // @ts-expect-error webkitdirectory not in types
                  webkitdirectory=""
                  multiple
                  className="hidden"
                  onChange={handleFolderUpload}
                />
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
                    Config files <span className="font-normal normal-case">(optional)</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => folderInputRef.current?.click()}
                      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors font-medium"
                    >
                      <FolderOpen size={11} /> Upload folder
                    </button>
                    <span className="text-muted-foreground/40 text-[11px]">|</span>
                    <button
                      onClick={addConfigFile}
                      className="flex items-center gap-1 text-[11px] text-primary hover:opacity-80 transition-opacity font-medium"
                    >
                      <Plus size={11} /> Add file
                    </button>
                  </div>
                </div>
                {configFiles.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground py-3 px-3 bg-muted/20 border border-dashed border-border rounded-lg text-center">
                    <button onClick={() => folderInputRef.current?.click()} className="text-foreground hover:underline font-medium">Upload a folder</button>
                    {' '}or{' '}
                    <button onClick={addConfigFile} className="text-primary hover:underline">add files manually</button>
                    <p className="mt-1 opacity-60">Injected before deploy — e.g. docker-compose.yml, Dockerfile</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {configFiles.map((cf, i) => (
                      <div key={i} className="border border-border rounded-lg p-3 bg-muted/10">
                        <div className="flex items-center gap-2 mb-2">
                          <input
                            className="input-field mono flex-1"
                            style={{ paddingTop: '5px', paddingBottom: '5px', fontSize: '12px' }}
                            placeholder="docker-compose.yml"
                            value={cf.path}
                            onChange={e => updateConfigFile(i, 'path', e.target.value)}
                          />
                          <button onClick={() => removeConfigFile(i)}
                            className="text-muted-foreground hover:text-destructive transition-colors shrink-0">
                            <Trash2 size={12} />
                          </button>
                        </div>
                        <textarea
                          className="input-field mono w-full"
                          style={{ fontSize: '11px', lineHeight: '1.5', resize: 'vertical', minHeight: '80px' }}
                          placeholder="# file content"
                          value={cf.content}
                          onChange={e => updateConfigFile(i, 'content', e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Tunnel section (single mode) */}
              <div>
                <button
                  type="button"
                  onClick={() => setTunnelEnabled(v => !v)}
                  className="w-full flex items-center justify-between px-3 py-2.5 border border-border rounded-lg text-xs font-medium transition-colors hover:bg-muted/40"
                  style={{ background: tunnelEnabled ? 'var(--color-muted)' : 'transparent' }}
                >
                  <span className="flex items-center gap-2 text-foreground">
                    <Cloud size={13} /> Cloudflare Tunnel
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${tunnelEnabled ? 'bg-primary text-primary-foreground' : 'bg-muted-foreground/20 text-muted-foreground'}`}>
                    {tunnelEnabled ? 'ON' : 'OFF'}
                  </span>
                </button>
                {tunnelEnabled && !cloudflareConfigured && (
                  <div className="mt-2 flex gap-2 items-start rounded-lg px-3 py-2.5 text-xs border border-amber-400/20 bg-amber-400/5 text-amber-400">
                    <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                    <span>Cloudflare credentials not configured. Go to <strong>Settings → Cloudflare</strong> first.</span>
                  </div>
                )}
                {tunnelEnabled && (
                  <div className="mt-2 flex flex-col gap-2 border border-border rounded-lg p-3 bg-muted/10">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">Tunnel name *</label>
                        <input className="input-field mono" style={{ fontSize: '12px', paddingTop: '5px', paddingBottom: '5px' }}
                          placeholder="my-app-tunnel" value={tunnelName} onChange={e => setTunnelName(e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">App port</label>
                        <input className="input-field mono" type="number" style={{ fontSize: '12px', paddingTop: '5px', paddingBottom: '5px' }}
                          value={tunnelAppPort} onChange={e => setTunnelAppPort(Number(e.target.value))} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">Public hostname *</label>
                      <input className="input-field mono" style={{ fontSize: '12px', paddingTop: '5px', paddingBottom: '5px' }}
                        placeholder="myapp.example.com" value={tunnelHostname} onChange={e => setTunnelHostname(e.target.value)} />
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-3.5">
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Webhook URL <span className="font-normal normal-case">(optional)</span></label>
                <input
                  className="input-field mono"
                  placeholder="https://your-service.com/hooks/deploy"
                  value={webhookUrl}
                  onChange={e => setWebhookUrl(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground mt-1">Called via HTTP POST on deployment success.</p>
              </div>

              {deployError && (
                <div className="flex gap-2 items-center rounded-lg px-3 py-2 mb-3 text-xs text-destructive border border-destructive/20 bg-destructive/5">
                  <AlertTriangle size={12} className="shrink-0" />{deployError}
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Application Configure ── */}
          {step === 3 && mode === 'application' && (
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Application name *</label>
                <input
                  className="input-field"
                  placeholder="my-app"
                  value={appName}
                  onChange={e => setAppName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-2 uppercase tracking-widest">
                  Services ({selections.size})
                </label>
                <div className="flex flex-col gap-1.5">
                  {Array.from(selections.values()).map(sel => (
                    <div key={sel.repo.fullName}
                      className="flex items-center gap-2 px-3 py-2 bg-muted/20 border border-border rounded-lg">
                      <Layers size={12} className="text-muted-foreground shrink-0" />
                      <span className="text-xs font-mono font-semibold text-foreground">{sel.subfolder}/</span>
                      <span className="text-xs text-muted-foreground flex-1 truncate">{sel.repo.fullName}</span>
                      <code className="text-[11px] text-muted-foreground font-mono shrink-0">:{sel.branch}</code>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <input
                  ref={folderInputRef}
                  type="file"
                  // @ts-expect-error webkitdirectory not in types
                  webkitdirectory=""
                  multiple
                  className="hidden"
                  onChange={handleFolderUpload}
                />
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">Config files</label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => folderInputRef.current?.click()}
                      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors font-medium"
                    >
                      <FolderOpen size={11} /> Upload folder
                    </button>
                    <span className="text-muted-foreground/40 text-[11px]">|</span>
                    <button
                      onClick={addConfigFile}
                      className="flex items-center gap-1 text-[11px] text-primary hover:opacity-80 transition-opacity font-medium"
                    >
                      <Plus size={11} /> Add file
                    </button>
                  </div>
                </div>
                {configFiles.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground py-3 px-3 bg-muted/20 border border-dashed border-border rounded-lg text-center">
                    <button onClick={() => folderInputRef.current?.click()} className="text-foreground hover:underline font-medium">Upload a folder</button>
                    {' '}or{' '}
                    <button onClick={addConfigFile} className="text-primary hover:underline">add files manually</button>
                    <p className="mt-1 opacity-60">e.g. docker-compose.yml, .env, nginx/nginx.conf</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {configFiles.map((cf, i) => (
                      <div key={i} className="border border-border rounded-lg p-3 bg-muted/10">
                        <div className="flex items-center gap-2 mb-2">
                          <input
                            className="input-field mono flex-1"
                            style={{ paddingTop: '5px', paddingBottom: '5px', fontSize: '12px' }}
                            placeholder="docker-compose.yml"
                            value={cf.path}
                            onChange={e => updateConfigFile(i, 'path', e.target.value)}
                          />
                          <button onClick={() => removeConfigFile(i)}
                            className="text-muted-foreground hover:text-destructive transition-colors shrink-0">
                            <Trash2 size={12} />
                          </button>
                        </div>
                        <textarea
                          className="input-field mono w-full"
                          style={{ fontSize: '11px', lineHeight: '1.5', resize: 'vertical', minHeight: '80px' }}
                          placeholder="# file content"
                          value={cf.content}
                          onChange={e => updateConfigFile(i, 'content', e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setTunnelEnabled(v => !v)}
                  className="w-full flex items-center justify-between px-3 py-2.5 border border-border rounded-lg text-xs font-medium transition-colors hover:bg-muted/40"
                  style={{ background: tunnelEnabled ? 'var(--color-muted)' : 'transparent' }}
                >
                  <span className="flex items-center gap-2 text-foreground">
                    <Cloud size={13} /> Cloudflare Tunnel
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${tunnelEnabled ? 'bg-primary text-primary-foreground' : 'bg-muted-foreground/20 text-muted-foreground'}`}>
                    {tunnelEnabled ? 'ON' : 'OFF'}
                  </span>
                </button>
                {tunnelEnabled && !cloudflareConfigured && (
                  <div className="mt-2 flex gap-2 items-start rounded-lg px-3 py-2.5 text-xs border border-amber-400/20 bg-amber-400/5 text-amber-400">
                    <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                    <span>Cloudflare credentials not configured. Go to <strong>Settings → Cloudflare</strong> to add your API token and Account ID first.</span>
                  </div>
                )}
                {tunnelEnabled && (
                  <div className="mt-2 flex flex-col gap-2 border border-border rounded-lg p-3 bg-muted/10">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">Tunnel name *</label>
                        <input className="input-field mono" style={{ fontSize: '12px', paddingTop: '5px', paddingBottom: '5px' }}
                          placeholder="my-app-tunnel" value={tunnelName} onChange={e => setTunnelName(e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">App port</label>
                        <input className="input-field mono" type="number" style={{ fontSize: '12px', paddingTop: '5px', paddingBottom: '5px' }}
                          value={tunnelAppPort} onChange={e => setTunnelAppPort(Number(e.target.value))} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">Public hostname *</label>
                      <input className="input-field mono" style={{ fontSize: '12px', paddingTop: '5px', paddingBottom: '5px' }}
                        placeholder="myapp.example.com" value={tunnelHostname} onChange={e => setTunnelHostname(e.target.value)} />
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      Requires Cloudflare token configured in Settings. A CNAME record will be created automatically.
                    </p>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Machine *</label>
                <select className="input-field" value={machineId || ''} onChange={e => setMachineId(Number(e.target.value))}>
                  <option value="">Select machine…</option>
                  {machines.map(m => <option key={m.id} value={m.id}>{m.name} ({m.host})</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Webhook URL <span className="font-normal normal-case">(optional)</span></label>
                <input
                  className="input-field mono"
                  placeholder="https://your-service.com/hooks/deploy"
                  value={webhookUrl}
                  onChange={e => setWebhookUrl(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground mt-1">Called via HTTP POST on deployment success.</p>
              </div>

              {deployError && (
                <div className="flex gap-2 items-center rounded-lg px-3 py-2 text-xs text-destructive border border-destructive/20 bg-destructive/5">
                  <AlertTriangle size={12} className="shrink-0" />{deployError}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-border flex gap-2 shrink-0">
          {step === 2 && (
            <>
              {!isConnected && (
                <button onClick={() => setStep(1)}
                  className="flex items-center gap-1.5 px-4 py-2 border border-border text-foreground text-sm rounded-lg hover:bg-muted transition-colors">
                  <ChevronLeft size={14} /> Back
                </button>
              )}
              <button onClick={proceedToStep3} disabled={selections.size === 0}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition-all">
                Continue with {selections.size} repo{selections.size !== 1 ? 's' : ''} <ChevronRight size={14} />
              </button>
            </>
          )}
          {step === 3 && (
            <>
              <button onClick={() => setStep(2)}
                className="flex items-center gap-1.5 px-4 py-2 border border-border text-foreground text-sm rounded-lg hover:bg-muted transition-colors">
                <ChevronLeft size={14} /> Back
              </button>
              <button onClick={handleDeploy}
                disabled={isDeploying || selections.size === 0 || !machineId || (mode === 'application' && !appName.trim())}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition-all">
                {isDeploying
                  ? <><Loader2 size={13} className="animate-spin" />Deploying…</>
                  : mode === 'application'
                    ? <><Layers size={13} />Deploy Application</>
                    : <><Rocket size={13} />Deploy {selections.size} repo{selections.size !== 1 ? 's' : ''}</>}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Infisical load modal */}
      {infisicalModalOpen && (
        <div onClick={e => e.stopPropagation()} className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
          <div className="bg-card border border-border rounded-2xl p-5 w-full max-w-sm shadow-2xl animate-fade-up">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Database size={16} className="text-muted-foreground" />
                <h3 className="font-semibold text-foreground text-sm">Load from Infisical</h3>
              </div>
              <button onClick={() => setInfisicalModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X size={16} />
              </button>
            </div>
            <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Environment</label>
            <input
              className="input-field mb-4"
              placeholder="dev, staging, prod…"
              value={infisicalEnv}
              onChange={e => setInfisicalEnv(e.target.value)}
            />
            {infisicalError && (
              <div className="flex gap-2 items-center rounded-lg px-3 py-2 mb-3 text-xs text-destructive border border-destructive/20 bg-destructive/5">
                <AlertTriangle size={12} className="shrink-0" />{infisicalError}
              </div>
            )}
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              Secrets from Infisical matching your detected variable names will be auto-filled. You can override them manually after.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setInfisicalModalOpen(false)}
                className="flex-1 py-2 border border-border text-foreground text-sm rounded-lg hover:bg-muted transition-colors">
                Cancel
              </button>
              <button onClick={handleLoadFromInfisical} disabled={loadingInfisical || !infisicalEnv.trim()}
                className="flex-1 flex items-center justify-center gap-2 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition-all">
                {loadingInfisical ? <><Loader2 size={13} className="animate-spin" />Loading…</> : <>Load secrets</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
