import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getDeployments, createDeployment, rollbackDeployment, getDeploymentLogs } from '../api/deployments'
import type { Deployment } from '../types'
import { getMachines } from '../api/machines'
import { getGitHubUser, type GHUser } from '../api/github'
import { Plus, RotateCcw, FileText, X, Search, Rocket, ChevronDown, ChevronRight } from 'lucide-react'
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
  // Sort groups by latest run date
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

export default function Deployments() {
  const qc = useQueryClient()
  const [showWizard, setShowWizard] = useState(false)
  const [logsModal, setLogsModal] = useState<{ id: number; name: string } | null>(null)
  const [search, setSearch] = useState('')
  const [isDeploying, setIsDeploying] = useState(false)
  const [ghUser, setGhUser] = useState<GHUser | null>(null)
  const [ghChecked, setGhChecked] = useState(false)
  const [watching, setWatching] = useState<{ id: number; name: string } | null>(null)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['deployments-all'],
    queryFn: () => getDeployments(0, 200),
  })
  const { data: machines } = useQuery({ queryKey: ['machines'], queryFn: getMachines })
  const { data: logs } = useQuery({
    queryKey: ['deployment-logs', logsModal?.id],
    queryFn: () => getDeploymentLogs(logsModal!.id),
    enabled: !!logsModal,
  })

  const rollbackMut = useMutation({
    mutationFn: rollbackDeployment,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deployments-all'] }),
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
      })
      qc.invalidateQueries({ queryKey: ['deployments-all'] })
      setShowWizard(false)
      setWatching({ id: dep.id, name: dep.name })
    } finally { setIsDeploying(false) }
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
            return (
              <div key={group.key} className="bg-card border border-border rounded-xl overflow-hidden transition-all">
                {/* Card header — clickable to expand */}
                <button
                  onClick={() => setExpandedKey(isExpanded ? null : group.key)}
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-muted/20 transition-colors text-left"
                >
                  <StackIcon stack={group.stack} size={36} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-foreground text-sm">{group.name}</p>
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
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
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
                            {run.version && (
                              <span className="text-[11px] font-mono text-muted-foreground/60 hidden sm:block truncate">
                                {run.version.slice(0, 8)}
                              </span>
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
                              onClick={() => setLogsModal({ id: run.id, name: run.name })}
                              title="View logs"
                              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <FileText size={13} />
                            </button>
                            {run.status === 'SUCCESS' && (
                              <button
                                onClick={() => rollbackMut.mutate(run.id)}
                                title="Rollback"
                                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-chart-5 transition-colors"
                              >
                                <RotateCcw size={13} />
                              </button>
                            )}
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

      {logsModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-2xl shadow-2xl animate-fade-up">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-foreground">Deployment Logs</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{logsModal.name}</p>
              </div>
              <button onClick={() => setLogsModal(null)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
            </div>
            <div className="terminal max-h-80">
              {logs?.map(l => `[${l.level}] ${l.message}`).join('\n') ?? 'Loading…'}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
