import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getDeployments, createDeployment, rollbackDeployment, getDeploymentLogs } from '../api/deployments'
import { getRepos } from '../api/github'
import { getMachines } from '../api/machines'
import { Search, Rocket, FileText, RotateCcw, X, Link2Off } from 'lucide-react'
import { GitHubIcon, StackIcon, StatusDot } from '../components/icons'
import DeployRepoWizard, { type DeployItem, type AppDeployPayload } from '../components/DeployRepoWizard'
import DeploymentWatcher from '../components/DeploymentWatcher'

interface GHUser { login: string; avatar_url: string }

function statusCls(s: string) {
  if (s === 'SUCCESS') return 'status-online'
  if (s === 'FAILED') return 'status-error'
  if (['BUILDING', 'DEPLOYING', 'PENDING'].includes(s)) return 'status-building'
  return 'status-muted'
}

export default function GitHub() {
  const [ghUser, setGhUser] = useState<GHUser | null>(() => {
    try { return JSON.parse(localStorage.getItem('gh_user') ?? 'null') } catch { return null }
  })
  const [showWizard, setShowWizard] = useState(false)
  const [search, setSearch] = useState('')
  const [logsModal, setLogsModal] = useState<{ id: number; name: string } | null>(null)
  const [watching, setWatching] = useState<{ id: number; name: string } | null>(null)

  // Check if a GitHub token is saved in the backend DB
  const { data: reposCheck, isError: noToken, isPending: checkingToken } = useQuery({
    queryKey: ['github-repos'],
    queryFn: getRepos,
    retry: false,
    staleTime: 60_000,
  })
  const isConnected = !noToken && !checkingToken && reposCheck !== undefined

  const qc = useQueryClient()

  const { data: allDeps, isLoading } = useQuery({
    queryKey: ['deployments-repo'],
    queryFn: () => getDeployments(0, 100),
  })
  const { data: machines } = useQuery({ queryKey: ['machines'], queryFn: getMachines })
  const { data: logs } = useQuery({
    queryKey: ['deployment-logs', logsModal?.id],
    queryFn: () => getDeploymentLogs(logsModal!.id),
    enabled: !!logsModal,
  })

  const deployMut = useMutation({ mutationFn: createDeployment })
  const rollbackMut = useMutation({
    mutationFn: rollbackDeployment,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deployments-repo'] }),
  })

  const repoDeploys = (allDeps?.content ?? []).filter(d => d.type === 'REPOSITORY')
  const filtered = repoDeploys.filter(d =>
    !search ||
    d.name.toLowerCase().includes(search.toLowerCase()) ||
    (d.repositoryUrl ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (d.branch ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const handleDeploy = async (items: DeployItem[]) => {
    let first = null
    for (const item of items) {
      const dep = await deployMut.mutateAsync({
        name: item.name,
        type: 'REPOSITORY',
        repositoryUrl: item.repoUrl,
        branch: item.branch,
        machineId: item.machineId,
      })
      if (!first) first = dep
    }
    qc.invalidateQueries({ queryKey: ['deployments-repo'] })
    qc.invalidateQueries({ queryKey: ['deployments', 0] })
    setShowWizard(false)
    if (first) setWatching({ id: first.id, name: first.name })
  }

  const handleAppDeploy = async (payload: AppDeployPayload) => {
    const dep = await deployMut.mutateAsync({
      name: payload.name,
      type: 'APPLICATION',
      machineId: payload.machineId,
      services: payload.services,
      configFiles: payload.configFiles,
      tunnelName: payload.tunnelName,
      tunnelHostname: payload.tunnelHostname,
      tunnelAppPort: payload.tunnelAppPort,
    })
    qc.invalidateQueries({ queryKey: ['deployments-repo'] })
    qc.invalidateQueries({ queryKey: ['deployments', 0] })
    setShowWizard(false)
    setWatching({ id: dep.id, name: dep.name })
  }

  const handlePatValidated = (user: GHUser) => {
    setGhUser(user)
    localStorage.setItem('gh_user', JSON.stringify(user))
    qc.invalidateQueries({ queryKey: ['github-repos'] })
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Connection banner */}
      {checkingToken ? (
        <div className="flex items-center gap-3 mb-5 px-4 py-3 bg-card border border-border rounded-xl animate-pulse h-[52px]" />
      ) : isConnected ? (
        <div className="flex items-center gap-3 mb-5 px-4 py-3 bg-card border border-border rounded-xl animate-fade-up">
          {ghUser ? (
            <>
              <img src={ghUser.avatar_url} alt="" className="w-7 h-7 rounded-full" />
              <div>
                <p className="text-sm font-semibold text-foreground">{ghUser.login}</p>
                <p className="text-[11px]" style={{ color: 'oklch(0.78 0.16 155)' }}>Token saved · connected to GitHub</p>
              </div>
            </>
          ) : (
            <>
              <GitHubIcon size={20} className="text-foreground" />
              <div>
                <p className="text-sm font-semibold text-foreground">Connected to GitHub</p>
                <p className="text-[11px]" style={{ color: 'oklch(0.78 0.16 155)' }}>Token saved in database</p>
              </div>
            </>
          )}
          <button
            onClick={() => setShowWizard(true)}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md hover:bg-muted font-medium"
          >
            Update token
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3 mb-5 px-4 py-3 bg-card border border-dashed border-border rounded-xl animate-fade-up">
          <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center">
            <Link2Off size={13} className="text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No GitHub token configured</p>
          <button onClick={() => setShowWizard(true)}
            className="ml-auto text-xs font-semibold text-foreground underline underline-offset-2 hover:opacity-80 transition-opacity">
            Connect →
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className="input-field" placeholder="Search repository deployments…"
            value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: '36px' }} />
        </div>
        <button onClick={() => setShowWizard(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 transition-all shrink-0">
          <Rocket size={14} /> Deploy Repository
        </button>
      </div>

      {/* Deployments table */}
      {isLoading ? (
        <div className="bg-card border border-border rounded-xl h-48 animate-pulse" />
      ) : !filtered.length ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <GitHubIcon size={36} className="opacity-20" />
          <p className="text-sm opacity-50">
            {repoDeploys.length ? 'No deployments match your search.' : 'No repository deployments yet.'}
          </p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b border-border">
              <tr>
                {['Repository', 'Branch', 'Stack', 'Machine', 'Status', 'Deployed', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(d => (
                <tr key={d.id} className="hover:bg-muted/20 transition-colors group">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <StackIcon stack={d.detectedStack} size={32} />
                      <div>
                        <p className="font-medium text-foreground">{d.name}</p>
                        {d.repositoryUrl && (
                          <p className="text-[11px] text-muted-foreground font-mono truncate max-w-[200px]">
                            {d.repositoryUrl.replace('https://github.com/', '')}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{d.branch ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{d.detectedStack ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{d.machineName ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <StatusDot status={d.status} />
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${statusCls(d.status)}`}>{d.status}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(d.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => setLogsModal({ id: d.id, name: d.name })} title="View logs"
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                        <FileText size={13} />
                      </button>
                      {d.status === 'SUCCESS' && (
                        <button onClick={() => rollbackMut.mutate(d.id)} title="Rollback"
                          className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                          <RotateCcw size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Deploy wizard */}
      {showWizard && (
        <DeployRepoWizard
          isConnected={isConnected}
          initialUser={ghUser}
          machines={machines ?? []}
          onCancel={() => setShowWizard(false)}
          onDeploy={handleDeploy}
          onAppDeploy={handleAppDeploy}
          isDeploying={deployMut.isPending}
          onPatValidated={handlePatValidated}
        />
      )}

      {watching && (
        <DeploymentWatcher
          deploymentId={watching.id}
          deploymentName={watching.name}
          onClose={() => { setWatching(null); qc.invalidateQueries({ queryKey: ['deployments-repo'] }) }}
        />
      )}

      {/* Logs modal */}
      {logsModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
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
