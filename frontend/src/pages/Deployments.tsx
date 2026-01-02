import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getDeployments, createDeployment, rollbackDeployment, getDeploymentLogs } from '../api/deployments'
import { getMachines } from '../api/machines'
import { getGitHubUser, type GHUser } from '../api/github'
import { Plus, RotateCcw, FileText, X, ChevronLeft, ChevronRight, Search, Rocket } from 'lucide-react'
import { StackIcon, StatusDot } from '../components/icons'
import DeployRepoWizard, { type DeployItem, type AppDeployPayload } from '../components/DeployRepoWizard'

function statusCls(s: string) {
  if (s === 'SUCCESS') return 'status-online'
  if (s === 'FAILED') return 'status-error'
  if (['BUILDING', 'DEPLOYING', 'PENDING'].includes(s)) return 'status-building'
  return 'status-muted'
}

export default function Deployments() {
  const qc = useQueryClient()
  const [page, setPage] = useState(0)
  const [showWizard, setShowWizard] = useState(false)
  const [logsModal, setLogsModal] = useState<{ id: number; name: string } | null>(null)
  const [search, setSearch] = useState('')
  const [isDeploying, setIsDeploying] = useState(false)
  const [ghUser, setGhUser] = useState<GHUser | null>(null)
  const [ghChecked, setGhChecked] = useState(false)

  const { data, isLoading } = useQuery({ queryKey: ['deployments', page], queryFn: () => getDeployments(page) })
  const { data: machines } = useQuery({ queryKey: ['machines'], queryFn: getMachines })
  const { data: logs } = useQuery({
    queryKey: ['deployment-logs', logsModal?.id],
    queryFn: () => getDeploymentLogs(logsModal!.id),
    enabled: !!logsModal,
  })

  const rollbackMut = useMutation({
    mutationFn: rollbackDeployment,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deployments'] }),
  })

  const openWizard = async () => {
    if (!ghChecked) {
      try {
        const user = await getGitHubUser()
        setGhUser(user)
      } catch { setGhUser(null) }
      setGhChecked(true)
    }
    setShowWizard(true)
  }

  const handleDeploy = async (items: DeployItem[]) => {
    setIsDeploying(true)
    try {
      for (const item of items) {
        await createDeployment({
          name: item.name,
          type: 'REPOSITORY',
          repositoryUrl: item.repoUrl,
          branch: item.branch,
          machineId: item.machineId,
        })
      }
      qc.invalidateQueries({ queryKey: ['deployments'] })
      setShowWizard(false)
    } finally {
      setIsDeploying(false)
    }
  }

  const handleAppDeploy = async (payload: AppDeployPayload) => {
    setIsDeploying(true)
    try {
      await createDeployment({
        name: payload.name,
        type: 'APPLICATION',
        machineId: payload.machineId,
        services: payload.services,
        configFiles: payload.configFiles,
        tunnelName: payload.tunnelName,
        tunnelHostname: payload.tunnelHostname,
        tunnelAppPort: payload.tunnelAppPort,
      })
      qc.invalidateQueries({ queryKey: ['deployments'] })
      setShowWizard(false)
    } finally {
      setIsDeploying(false)
    }
  }

  const filtered = (data?.content ?? []).filter(d =>
    !search || d.name.toLowerCase().includes(search.toLowerCase()) || (d.detectedStack ?? '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-6 max-w-6xl mx-auto">
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
        <div className="bg-card border border-border rounded-xl h-48 animate-pulse" />
      ) : !filtered.length ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <Rocket size={36} className="opacity-20" />
          <p className="text-sm opacity-50">{data?.content.length ? 'No deployments match your search.' : 'No deployments yet.'}</p>
        </div>
      ) : (
        <>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  {['Deployment', 'Type', 'Stack', 'Machine', 'Status', 'Created', ''].map(h => (
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
                          {d.branch && <p className="text-[11px] text-muted-foreground font-mono">{d.branch}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{d.type}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{d.detectedStack ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{d.machineName ?? '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <StatusDot status={d.status} />
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${statusCls(d.status)}`}>{d.status}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">{new Date(d.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setLogsModal({ id: d.id, name: d.name })} title="View logs"
                          className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-accent transition-colors"><FileText size={13}/></button>
                        {d.status === 'SUCCESS' && (
                          <button onClick={() => rollbackMut.mutate(d.id)} title="Rollback"
                            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-chart-5 transition-colors"><RotateCcw size={13}/></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-muted-foreground">Page {page + 1} of {data.totalPages} · {data.totalElements} total</p>
              <div className="flex gap-1.5">
                <button disabled={page === 0} onClick={() => setPage(page - 1)}
                  className="p-1.5 rounded-lg border border-border text-foreground disabled:opacity-30 hover:bg-muted transition-colors"><ChevronLeft size={14}/></button>
                <button disabled={page >= data.totalPages - 1} onClick={() => setPage(page + 1)}
                  className="p-1.5 rounded-lg border border-border text-foreground disabled:opacity-30 hover:bg-muted transition-colors"><ChevronRight size={14}/></button>
              </div>
            </div>
          )}
        </>
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

      {logsModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-2xl shadow-2xl animate-fade-up">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-foreground">Deployment Logs</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{logsModal.name}</p>
              </div>
              <button onClick={() => setLogsModal(null)} className="text-muted-foreground hover:text-foreground"><X size={18}/></button>
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
