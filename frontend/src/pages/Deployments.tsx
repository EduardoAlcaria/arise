import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getDeployments, createDeployment, rollbackDeployment, redeployDeployment, addDeploymentTunnel, deleteDeployment, removeDeploymentTunnel } from '../api/deployments'
import type { Deployment } from '../types'
import { getMachines } from '../api/machines'
import { getGitHubUser, type GHUser } from '../api/github'
import { Plus, RotateCcw, RefreshCw, FileText, X, Search, Rocket, ChevronDown, ChevronRight, Radio, Cloud, ExternalLink, AlertTriangle, Loader2, Trash2, CloudOff } from 'lucide-react'
import { StackIcon, StatusDot } from '../components/icons'
import DeployRepoWizard, { type DeployItem, type AppDeployPayload } from '../components/DeployRepoWizard'
import DeploymentWatcher from '../components/DeploymentWatcher'

function statusCls(s: string) {
  if (s === 'SUCCESS') return 'status-online'
  if (s === 'FAILED') return 'status-error'
  if (['BUILDING', 'DEPLOYING', 'PENDING'].includes(s)) return 'status-building'
  return 'status-muted'
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

function extractRepoName(url: string | null, fallback: string): string {
  if (!url) return fallback
  const parts = url.replace(/\.git$/, '').split('/')
  return parts[parts.length - 1] ?? fallback
}

type RepoGroup = {
  key: string
  name: string
  stack: string | null
  runs: Deployment[]
  latest: Deployment
}

function groupDeployments(deployments: Deployment[]): RepoGroup[] {
  const map = new Map<string, Deployment[]>()
  for (const d of deployments) {
    const key = d.repositoryUrl ?? d.name
    const list = map.get(key) ?? []
    list.push(d)
    map.set(key, list)
  }
  const groups: RepoGroup[] = []
  for (const [key, runs] of map) {
    runs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    groups.push({
      key,
      name: extractRepoName(runs[0].repositoryUrl, runs[0].name),
      stack: runs[0].detectedStack,
      runs,
      latest: runs[0],
    })
  }
  groups.sort((a, b) => new Date(b.latest.createdAt).getTime() - new Date(a.latest.createdAt).getTime())
  return groups
}

function branchesForGroup(runs: Deployment[]): string[] {
  const seen = new Set<string>()
  const branches: string[] = []
  for (const r of runs) {
    if (r.branch && !seen.has(r.branch)) {
      seen.add(r.branch)
      branches.push(r.branch)
    }
  }
  return branches
}

interface TunnelModalState {
  deploymentId: number
  deploymentName: string
}

export default function Deployments() {
  const qc = useQueryClient()
  const [showWizard, setShowWizard] = useState(false)
  const [search, setSearch] = useState('')
  const [isDeploying, setIsDeploying] = useState(false)
  const [ghUser, setGhUser] = useState<GHUser | null>(null)
  const [ghChecked, setGhChecked] = useState(false)
  const [watching, setWatching] = useState<{ id: number; name: string } | null>(null)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  // Confirm delete modal
  type ConfirmAction = { id: number; label: string; type: 'deployment' | 'tunnel' }
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null)

  // Tunnel modal state
  const [tunnelModal, setTunnelModal] = useState<TunnelModalState | null>(null)
  const [tunnelName, setTunnelName] = useState('')
  const [tunnelHostname, setTunnelHostname] = useState('')
  const [tunnelAppPort, setTunnelAppPort] = useState(80)
  const [tunnelError, setTunnelError] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['deployments-all'],
    queryFn: () => getDeployments(0, 200),
  })
  const { data: machines } = useQuery({ queryKey: ['machines'], queryFn: getMachines })
  const rollbackMut = useMutation({
    mutationFn: rollbackDeployment,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deployments-all'] }),
  })

  const redeployMut = useMutation({
    mutationFn: redeployDeployment,
    onSuccess: (dep) => {
      qc.invalidateQueries({ queryKey: ['deployments-all'] })
      setWatching({ id: dep.id, name: dep.name })
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteDeployment(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deployments-all'] })
      setConfirm(null)
    },
  })

  const removeTunnelMut = useMutation({
    mutationFn: (id: number) => removeDeploymentTunnel(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deployments-all'] })
      setConfirm(null)
    },
  })

  const tunnelMut = useMutation({
    mutationFn: ({ id, name, hostname, port }: { id: number; name: string; hostname: string; port: number }) =>
      addDeploymentTunnel(id, name, hostname, port),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deployments-all'] })
      setTunnelModal(null)
      setTunnelName('')
      setTunnelHostname('')
      setTunnelAppPort(80)
      setTunnelError('')
    },
    onError: (e: any) => setTunnelError(e?.response?.data?.message ?? e?.message ?? 'Tunnel creation failed'),
  })

  const openWizard = async () => {
    if (!ghChecked) {
      try { const user = await getGitHubUser(); setGhUser(user) } catch { setGhUser(null) }
      setGhChecked(true)
    }
    setShowWizard(true)
  }

  const handleDeploy = async (items: DeployItem[]) => {
    setIsDeploying(true)
    try {
      let first: Deployment | null = null
      for (const item of items) {
        const dep = await createDeployment({
          name: item.name, type: 'REPOSITORY',
          repositoryUrl: item.repoUrl, branch: item.branch, machineId: item.machineId,
          tunnelName: item.tunnelName, tunnelHostname: item.tunnelHostname, tunnelAppPort: item.tunnelAppPort,
          configFiles: item.configFiles,
          webhookUrl: item.webhookUrl,
        })
        if (!first) first = dep
      }
      qc.invalidateQueries({ queryKey: ['deployments-all'] })
      setShowWizard(false)
      if (first) setWatching({ id: first.id, name: first.name })
    } finally { setIsDeploying(false) }
  }

  const handleAppDeploy = async (payload: AppDeployPayload) => {
    setIsDeploying(true)
    try {
      const dep = await createDeployment({
        name: payload.name, type: 'APPLICATION', machineId: payload.machineId,
        services: payload.services, configFiles: payload.configFiles,
        tunnelName: payload.tunnelName, tunnelHostname: payload.tunnelHostname, tunnelAppPort: payload.tunnelAppPort,
        webhookUrl: payload.webhookUrl,
      })
      qc.invalidateQueries({ queryKey: ['deployments-all'] })
      setShowWizard(false)
      setWatching({ id: dep.id, name: dep.name })
    } finally { setIsDeploying(false) }
  }

  const openTunnelModal = (deployment: Deployment, e: React.MouseEvent) => {
    e.stopPropagation()
    setTunnelError('')
    setTunnelName(deployment.name + '-tunnel')
    setTunnelHostname('')
    setTunnelAppPort(80)
    setTunnelModal({ deploymentId: deployment.id, deploymentName: deployment.name })
  }

  const submitTunnel = () => {
    if (!tunnelModal) return
    if (!tunnelName.trim() || !tunnelHostname.trim()) {
      setTunnelError('Tunnel name and hostname are required')
      return
    }
    tunnelMut.mutate({ id: tunnelModal.deploymentId, name: tunnelName.trim(), hostname: tunnelHostname.trim(), port: tunnelAppPort })
  }

  const allGroups = groupDeployments(data?.content ?? [])
  const filteredGroups = allGroups.filter(g =>
    !search || g.name.toLowerCase().includes(search.toLowerCase()) ||
    g.key.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className="input-field" placeholder="Search deployments…" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: '36px' }} />
        </div>
        <button onClick={openWizard} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 transition-all shrink-0">
          <Plus size={15} /> New Deployment
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="bg-card border border-border rounded-xl h-20 animate-pulse" />)}
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <Rocket size={36} className="opacity-20" />
          <p className="text-sm opacity-50">{allGroups.length ? 'No deployments match your search.' : 'No deployments yet.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredGroups.map(group => {
            const isExpanded = expandedKey === group.key
            const branches = branchesForGroup(group.runs)
            const hasTunnel = !!group.latest.cloudfareTunnelUrl
            return (
              <div key={group.key} className="bg-card border border-border rounded-xl overflow-hidden transition-all">
                {/* Card header */}
                <button
                  onClick={() => setExpandedKey(isExpanded ? null : group.key)}
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-muted/20 transition-colors text-left"
                >
                  <StackIcon stack={group.stack} size={36} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-foreground text-sm">{group.name}</p>
                      {group.latest.type === 'APPLICATION' && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary">APP</span>
                      )}
                      {branches.slice(0, 3).map(b => (
                        <span key={b} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {b}
                        </span>
                      ))}
                      {branches.length > 3 && (
                        <span className="text-[10px] text-muted-foreground">+{branches.length - 3} more</span>
                      )}
                    </div>
                    {group.latest.repositoryUrl && (
                      <p className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">
                        {group.latest.repositoryUrl.replace('https://github.com/', '')}
                      </p>
                    )}
                    {group.latest.webhookUrl && (
                      <p className="text-[11px] text-muted-foreground/60 font-mono truncate mt-0.5">
                        hook: {group.latest.webhookUrl}
                      </p>
                    )}
                    {hasTunnel && (
                      <a
                        href={group.latest.cloudfareTunnelUrl!}
                        target="_blank"
                        rel="noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline mt-0.5"
                      >
                        <Cloud size={10} />
                        {group.latest.cloudfareTunnelUrl}
                        <ExternalLink size={9} />
                      </a>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {/* Tunnel button for any successful deployment without tunnel */}
                    {group.latest.status === 'SUCCESS' && !hasTunnel && (
                      <button
                        onClick={e => openTunnelModal(group.latest, e)}
                        title="Create Cloudflare tunnel"
                        className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-border hover:border-primary hover:text-primary text-muted-foreground transition-colors"
                      >
                        <Cloud size={12} /> Add Tunnel
                      </button>
                    )}

                    <div className="text-right hidden sm:block">
                      <div className="flex items-center gap-1.5 justify-end">
                        <StatusDot status={group.latest.status} />
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${statusCls(group.latest.status)}`}>
                          {group.latest.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{group.runs.length} run{group.runs.length !== 1 ? 's' : ''}</p>
                    </div>
                    <div className="text-right hidden md:block">
                      <p className="text-[11px] text-muted-foreground">{timeAgo(group.latest.createdAt)}</p>
                      {group.latest.machineName && (
                        <p className="text-[10px] text-muted-foreground/60">{group.latest.machineName}</p>
                      )}
                    </div>
                    {isExpanded
                      ? <ChevronDown size={16} className="text-muted-foreground shrink-0" />
                      : <ChevronRight size={16} className="text-muted-foreground shrink-0" />
                    }
                  </div>
                </button>

                {/* Expanded runs */}
                {isExpanded && (
                  <div className="border-t border-border">
                    <div className="px-5 py-2 bg-muted/20 flex items-center gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        All runs ({group.runs.length})
                      </span>
                    </div>
                    <div className="divide-y divide-border">
                      {group.runs.map(run => (
                        <div key={run.id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/10 transition-colors group">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <StatusDot status={run.status} />
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${statusCls(run.status)}`}>
                              {run.status}
                            </span>
                            {run.branch && (
                              <span className="text-[11px] font-mono text-muted-foreground truncate">
                                {run.branch}
                              </span>
                            )}
                            {run.cloudfareTunnelUrl && (
                              <div className="flex items-center gap-1 shrink-0">
                                <a
                                  href={run.cloudfareTunnelUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={e => e.stopPropagation()}
                                  className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                                >
                                  <Cloud size={10} />{run.tunnelHostname ?? run.cloudfareTunnelUrl}
                                </a>
                                <button
                                  onClick={e => { e.stopPropagation(); setConfirm({ id: run.id, label: run.tunnelHostname ?? 'tunnel', type: 'tunnel' }) }}
                                  title="Remove tunnel"
                                  className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive transition-colors"
                                >
                                  <CloudOff size={11} />
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="text-right shrink-0 hidden sm:block">
                            {run.machineName && (
                              <p className="text-[11px] text-muted-foreground">{run.machineName}</p>
                            )}
                            <p className="text-[10px] text-muted-foreground/60">{timeAgo(run.createdAt)}</p>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            <button
                              onClick={() => setWatching({ id: run.id, name: run.name })}
                              title={['BUILDING', 'DEPLOYING', 'PENDING'].includes(run.status) ? 'Watch live' : 'View logs'}
                              className={`p-1.5 rounded hover:bg-muted transition-colors ${['BUILDING', 'DEPLOYING', 'PENDING'].includes(run.status) ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                            >
                              {['BUILDING', 'DEPLOYING', 'PENDING'].includes(run.status) ? <Radio size={13} /> : <FileText size={13} />}
                            </button>
                            {run.status === 'SUCCESS' && !run.cloudfareTunnelUrl && (
                              <button
                                onClick={e => openTunnelModal(run, e)}
                                title="Create tunnel"
                                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-primary transition-colors"
                              >
                                <Cloud size={13} />
                              </button>
                            )}
                            {(run.status === 'SUCCESS' || run.status === 'FAILED') && (
                              <button
                                onClick={() => redeployMut.mutate(run.id)}
                                title="Redeploy"
                                disabled={redeployMut.isPending}
                                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <RefreshCw size={13} />
                              </button>
                            )}
                            {run.status === 'SUCCESS' && (
                              <button
                                onClick={() => rollbackMut.mutate(run.id)}
                                title="Rollback"
                                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-chart-5 transition-colors"
                              >
                                <RotateCcw size={13} />
                              </button>
                            )}
                            <button
                              onClick={() => setConfirm({ id: run.id, label: run.name, type: 'deployment' })}
                              title="Delete deployment"
                              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive transition-colors"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showWizard && (
        <DeployRepoWizard
          isConnected={!!ghUser}
          initialUser={ghUser}
          machines={machines ?? []}
          onCancel={() => setShowWizard(false)}
          onDeploy={handleDeploy}
          onAppDeploy={handleAppDeploy}
          isDeploying={isDeploying}
          onPatValidated={user => setGhUser(user)}
        />
      )}

      {watching && (
        <DeploymentWatcher
          deploymentId={watching.id}
          deploymentName={watching.name}
          onClose={() => { setWatching(null); qc.invalidateQueries({ queryKey: ['deployments-all'] }) }}
        />
      )}

      {/* Tunnel creation modal */}
      {tunnelModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl animate-fade-up">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                  <Cloud size={15} className="text-foreground" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground text-sm">Create Cloudflare Tunnel</h3>
                  <p className="text-[11px] text-muted-foreground">{tunnelModal.deploymentName}</p>
                </div>
              </div>
              <button onClick={() => setTunnelModal(null)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X size={16} />
              </button>
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Tunnel Name *</label>
                <input
                  className="input-field"
                  placeholder="my-app-tunnel"
                  value={tunnelName}
                  onChange={e => setTunnelName(e.target.value)}
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Public Hostname *</label>
                <input
                  className="input-field mono"
                  placeholder="myapp.yourdomain.com"
                  value={tunnelHostname}
                  onChange={e => setTunnelHostname(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground mt-1">Must be on a Cloudflare-managed domain. A CNAME record will be created automatically.</p>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">App Port</label>
                <input
                  className="input-field mono"
                  type="number"
                  value={tunnelAppPort}
                  onChange={e => setTunnelAppPort(Number(e.target.value))}
                  min={1}
                  max={65535}
                />
                <p className="text-[11px] text-muted-foreground mt-1">The port your application listens on inside the machine.</p>
              </div>

              {tunnelError && (
                <div className="flex gap-2 items-start rounded-lg px-3 py-2.5 text-xs text-destructive border border-destructive/20 bg-destructive/5">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" />{tunnelError}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setTunnelModal(null)}
                  className="flex-1 py-2 border border-border text-foreground text-sm rounded-lg hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={submitTunnel}
                  disabled={tunnelMut.isPending || !tunnelName.trim() || !tunnelHostname.trim()}
                  className="flex-1 flex items-center justify-center gap-2 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition-all"
                >
                  {tunnelMut.isPending
                    ? <><Loader2 size={13} className="animate-spin" />Creating…</>
                    : <><Cloud size={13} />Create Tunnel</>
                  }
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-fade-up">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
                <Trash2 size={16} className="text-destructive" />
              </div>
              <div>
                <p className="font-semibold text-foreground text-sm">
                  {confirm.type === 'deployment' ? 'Delete deployment?' : 'Remove tunnel?'}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5 font-mono truncate max-w-[220px]">{confirm.label}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mb-5">
              {confirm.type === 'deployment'
                ? 'This will stop running containers, delete the Cloudflare tunnel if any, and remove all logs. This cannot be undone.'
                : 'This will delete the Cloudflare tunnel and DNS record. The running cloudflared container on the machine will not be stopped automatically.'}
            </p>
            {(deleteMut.isError || removeTunnelMut.isError) && (
              <div className="flex gap-2 items-center rounded-lg px-3 py-2 text-xs text-destructive border border-destructive/20 bg-destructive/5 mb-3">
                <AlertTriangle size={12} className="shrink-0" />
                {((deleteMut.error ?? removeTunnelMut.error) as any)?.response?.data?.message ?? 'Operation failed'}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => { setConfirm(null); deleteMut.reset(); removeTunnelMut.reset() }}
                className="flex-1 py-2 border border-border text-foreground text-sm rounded-lg hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => confirm.type === 'deployment' ? deleteMut.mutate(confirm.id) : removeTunnelMut.mutate(confirm.id)}
                disabled={deleteMut.isPending || removeTunnelMut.isPending}
                className="flex-1 flex items-center justify-center gap-2 py-2 bg-destructive text-destructive-foreground text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition-all"
              >
                {(deleteMut.isPending || removeTunnelMut.isPending)
                  ? <><Loader2 size={13} className="animate-spin" />Deleting…</>
                  : <><Trash2 size={13} />{confirm.type === 'deployment' ? 'Delete' : 'Remove tunnel'}</>
                }
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
