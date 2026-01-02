import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getContainers, deployContainer, stopContainer, restartContainer, removeContainer, getContainerLogs, type ContainerDeployRequest } from '../api/containers'
import { getMachines } from '../api/machines'
import { Plus, Square, RotateCcw, Trash2, FileText, X, Search } from 'lucide-react'
import { DockerIcon, StatusDot } from '../components/icons'

const emptyForm: ContainerDeployRequest = { name: '', image: '', machineId: 0 }

function statusCls(s: string) {
  if (s === 'RUNNING') return 'status-online'
  if (s === 'FAILED') return 'status-error'
  if (['PULLING','PENDING'].includes(s)) return 'status-building'
  return 'status-muted'
}

export default function Containers() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<ContainerDeployRequest & { envRaw: string }>({ ...emptyForm, envRaw: '' })
  const [logsModal, setLogsModal] = useState<{ id: number; name: string } | null>(null)
  const [search, setSearch] = useState('')

  const { data: containers, isLoading } = useQuery({ queryKey: ['containers'], queryFn: getContainers })
  const { data: machines } = useQuery({ queryKey: ['machines'], queryFn: getMachines })
  const { data: logs } = useQuery({
    queryKey: ['container-logs', logsModal?.id],
    queryFn: () => getContainerLogs(logsModal!.id),
    enabled: !!logsModal,
  })

  const deployMut   = useMutation({ mutationFn: deployContainer,  onSuccess: () => { qc.invalidateQueries({ queryKey: ['containers'] }); setShowForm(false); setForm({ ...emptyForm, envRaw: '' }) } })
  const stopMut     = useMutation({ mutationFn: stopContainer,    onSuccess: () => qc.invalidateQueries({ queryKey: ['containers'] }) })
  const restartMut  = useMutation({ mutationFn: restartContainer, onSuccess: () => qc.invalidateQueries({ queryKey: ['containers'] }) })
  const removeMut   = useMutation({ mutationFn: removeContainer,  onSuccess: () => qc.invalidateQueries({ queryKey: ['containers'] }) })

  const handleDeploy = (e: React.FormEvent) => {
    e.preventDefault()
    const envVars: Record<string, string> = {}
    form.envRaw.split('\n').forEach(line => { const [k, ...rest] = line.split('='); if (k?.trim()) envVars[k.trim()] = rest.join('=').trim() })
    deployMut.mutate({ name: form.name, image: form.image, hostPort: form.hostPort, containerPort: form.containerPort, envVars, machineId: form.machineId })
  }

  const filtered = (containers ?? []).filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.image.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className="input-field" placeholder="Search containers…" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: '36px' }} />
        </div>
        <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 transition-all shrink-0">
          <Plus size={15} /> Deploy Container
        </button>
      </div>

      {isLoading ? (
        <div className="bg-card border border-border rounded-xl h-48 animate-pulse" />
      ) : !filtered.length ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <DockerIcon size={36} />
          <p className="text-sm opacity-50">{containers?.length ? 'No containers match your search.' : 'No containers deployed yet.'}</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b border-border">
              <tr>
                {['Container', 'Image', 'Ports', 'Machine', 'Status', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(c => (
                <tr key={c.id} className="hover:bg-muted/20 transition-colors group">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <DockerIcon size={18} />
                      <span className="font-medium text-foreground">{c.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{c.image}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs font-mono">{c.hostPort ? `${c.hostPort}:${c.containerPort}` : '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{c.machineName}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <StatusDot status={c.status} />
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${statusCls(c.status)}`}>{c.status}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => stopMut.mutate(c.id)} disabled={c.status !== 'RUNNING'} title="Stop"
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-chart-5 disabled:opacity-25 transition-colors"><Square size={13}/></button>
                      <button onClick={() => restartMut.mutate(c.id)} title="Restart"
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-primary transition-colors"><RotateCcw size={13}/></button>
                      <button onClick={() => setLogsModal({ id: c.id, name: c.name })} title="Logs"
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-accent transition-colors"><FileText size={13}/></button>
                      <button onClick={() => { if (confirm('Remove container?')) removeMut.mutate(c.id) }} title="Remove"
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive transition-colors"><Trash2 size={13}/></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Deploy modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg shadow-2xl animate-fade-up max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-foreground">Deploy Container</h3>
              <button onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-foreground"><X size={18}/></button>
            </div>
            <form onSubmit={handleDeploy} className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Name</label>
                <input className="input-field" required placeholder="my-app" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Image</label>
                <input className="input-field mono" required placeholder="nginx:latest" value={form.image} onChange={e => setForm({ ...form, image: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Host Port</label>
                  <input className="input-field mono" type="number" placeholder="8080" value={form.hostPort ?? ''} onChange={e => setForm({ ...form, hostPort: e.target.value ? Number(e.target.value) : undefined })} />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Container Port</label>
                  <input className="input-field mono" type="number" placeholder="80" value={form.containerPort ?? ''} onChange={e => setForm({ ...form, containerPort: e.target.value ? Number(e.target.value) : undefined })} />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Machine</label>
                <select className="input-field" required value={form.machineId || ''} onChange={e => setForm({ ...form, machineId: Number(e.target.value) })}>
                  <option value="">Select machine…</option>
                  {machines?.map(m => <option key={m.id} value={m.id}>{m.name} ({m.host})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">ENV Variables</label>
                <textarea className="input-field mono" rows={3} placeholder={"KEY=value\nANOTHER_KEY=value"} value={form.envRaw} onChange={e => setForm({ ...form, envRaw: e.target.value })} />
              </div>
              {deployMut.error && <p className="text-destructive text-xs">{(deployMut.error as any).response?.data?.message}</p>}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2.5 border border-border text-foreground text-sm rounded-lg hover:bg-muted transition-colors">Cancel</button>
                <button type="submit" disabled={deployMut.isPending} className="flex-1 py-2.5 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition-all">
                  {deployMut.isPending ? 'Deploying…' : 'Deploy'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Logs modal */}
      {logsModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-2xl shadow-2xl animate-fade-up">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-foreground">Container Logs</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{logsModal.name}</p>
              </div>
              <button onClick={() => setLogsModal(null)} className="text-muted-foreground hover:text-foreground"><X size={18}/></button>
            </div>
            <div className="terminal max-h-80">{logs?.logs ?? 'Loading…'}</div>
          </div>
        </div>
      )}
    </div>
  )
}
