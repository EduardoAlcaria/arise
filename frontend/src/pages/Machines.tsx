import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getMachines, createMachine, updateMachine, deleteMachine, testMachine, type MachineRequest } from '../api/machines'
import { Plus, Trash2, Wifi, Terminal, X, Search, Server, Pencil } from 'lucide-react'
import { OsIcon, StatusDot } from '../components/icons'
import TerminalModal from '../components/TerminalModal'

const emptyForm: MachineRequest = { name: '', host: '', port: 22, sshUser: '', privateKey: '' }

function statusCls(s: string) {
  if (s === 'ONLINE') return 'status-online'
  if (s === 'ERROR') return 'status-error'
  return 'status-muted'
}

function timeAgo(iso: string | null) {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'Just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function Machines() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<MachineRequest>(emptyForm)
  const [terminalModal, setTerminalModal] = useState<{ id: number; name: string } | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'ALL' | 'ONLINE' | 'OFFLINE' | 'ERROR'>('ALL')

  const { data: machines, isLoading } = useQuery({ queryKey: ['machines'], queryFn: getMachines })

  const closeForm = () => { setShowForm(false); setEditingId(null); setForm(emptyForm) }

  const createMut = useMutation({
    mutationFn: createMachine,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['machines'] }); closeForm() },
  })
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: MachineRequest }) => updateMachine(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['machines'] }); closeForm() },
  })
  const deleteMut = useMutation({ mutationFn: deleteMachine, onSuccess: () => qc.invalidateQueries({ queryKey: ['machines'] }) })
  const testMut   = useMutation({ mutationFn: testMachine })

  const filtered = (machines ?? []).filter(m => {
    if (filter !== 'ALL' && m.status !== filter) return false
    if (search && !m.name.toLowerCase().includes(search.toLowerCase()) && !m.host.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            className="input-field pl-9"
            placeholder="Search machines…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: '36px' }}
          />
        </div>
        <div className="flex items-center gap-2">
          {(['ALL','ONLINE','OFFLINE','ERROR'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
              {f}
            </button>
          ))}
        </div>
        <button
          onClick={() => { setEditingId(null); setForm(emptyForm); setShowForm(true) }}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 transition-all shrink-0"
        >
          <Plus size={15} /> Register Machine
        </button>
      </div>

      {/* Cards grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-5 h-[148px] animate-pulse" />
          ))}
        </div>
      ) : !filtered.length ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <Server size={36} className="opacity-20" />
          <p className="text-sm">{machines?.length ? 'No machines match your filter.' : 'No machines registered.'}</p>
          {!machines?.length && (
            <button onClick={() => setShowForm(true)} className="text-xs text-primary hover:underline flex items-center gap-1">
              <Plus size={12}/> Register your first machine
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 stagger">
          {filtered.map(m => (
            <div
              key={m.id}
              className="bg-card border border-border rounded-xl p-5 animate-fade-up card-hover group relative overflow-hidden"
              style={{ borderLeft: `3px solid ${m.status === 'ONLINE' ? 'var(--color-accent)' : m.status === 'ERROR' ? 'var(--color-destructive)' : 'var(--border)'}` }}
            >
              <div className="flex items-start gap-3 mb-3.5">
                <OsIcon name={m.name} size={40} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{m.name}</p>
                  <p className="text-xs text-muted-foreground truncate" style={{ fontFamily: "'Fira Code', monospace" }}>
                    {m.sshUser}@{m.host}:{m.port}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <StatusDot status={m.status} />
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${statusCls(m.status)}`}>{m.status}</span>
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground mb-4">Last seen {timeAgo(m.lastSeen)}</p>

              <div className="flex items-center gap-1.5 pt-3 border-t border-border">
                <button
                  onClick={() => testMut.mutate(m.id)}
                  title="Test SSH connection"
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-accent hover:bg-accent/10 transition-colors"
                >
                  <Wifi size={12} /> Test
                </button>
                <button
                  onClick={() => setTerminalModal({ id: m.id, name: m.name })}
                  title="Open terminal"
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                >
                  <Terminal size={12} /> Terminal
                </button>
                <button
                  onClick={() => {
                    setEditingId(m.id)
                    setForm({ name: m.name, host: m.host, port: m.port, sshUser: m.sshUser, privateKey: '' })
                    setShowForm(true)
                  }}
                  title="Edit"
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <Pencil size={12} />
                </button>
                <button
                  onClick={() => { if (confirm('Delete machine?')) deleteMut.mutate(m.id) }}
                  title="Delete"
                  className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Register / Edit modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg shadow-2xl animate-fade-up">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-foreground">{editingId ? 'Edit Machine' : 'Register Machine'}</h3>
              <button onClick={closeForm} className="text-muted-foreground hover:text-foreground transition-colors"><X size={18}/></button>
            </div>
            <form
              onSubmit={e => {
                e.preventDefault()
                editingId ? updateMut.mutate({ id: editingId, data: form }) : createMut.mutate(form)
              }}
              className="space-y-3"
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Name</label>
                  <input className="input-field" required placeholder="my-server" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Port</label>
                  <input className="input-field mono" type="number" required value={form.port} onChange={e => setForm({ ...form, port: Number(e.target.value) })} />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Hostname / IP</label>
                <input className="input-field mono" required placeholder="10.0.0.1" value={form.host} onChange={e => setForm({ ...form, host: e.target.value })} />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">SSH User</label>
                <input className="input-field mono" required placeholder="root" value={form.sshUser} onChange={e => setForm({ ...form, sshUser: e.target.value })} />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">
                  Private Key (PEM){editingId && <span className="ml-1 normal-case font-normal text-muted-foreground">— leave blank to keep existing</span>}
                </label>
                <textarea
                  className="input-field mono"
                  required={!editingId}
                  rows={5}
                  placeholder={editingId ? '(unchanged)' : '-----BEGIN OPENSSH PRIVATE KEY-----'}
                  value={form.privateKey}
                  onChange={e => setForm({ ...form, privateKey: e.target.value })}
                />
              </div>
              {(createMut.error || updateMut.error) && (
                <p className="text-destructive text-xs">
                  {((createMut.error ?? updateMut.error) as any)?.response?.data?.message ?? 'Request failed'}
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={closeForm} className="flex-1 py-2.5 border border-border text-foreground text-sm rounded-lg hover:bg-muted transition-colors">Cancel</button>
                <button type="submit" disabled={createMut.isPending || updateMut.isPending}
                  className="flex-1 py-2.5 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition-all">
                  {(createMut.isPending || updateMut.isPending) ? 'Saving…' : editingId ? 'Save Changes' : 'Register'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {terminalModal && (
        <TerminalModal
          machineId={terminalModal.id}
          machineName={terminalModal.name}
          onClose={() => setTerminalModal(null)}
        />
      )}
    </div>
  )
}
