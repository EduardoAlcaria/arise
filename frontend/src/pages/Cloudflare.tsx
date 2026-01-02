import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { saveCloudflareToken, getZones, getTunnels, createTunnel } from '../api/cloudflare'
import { Plus, X, Key, Globe, Wifi } from 'lucide-react'
import { CloudflareIcon, StatusDot } from '../components/icons'

export default function Cloudflare() {
  const qc = useQueryClient()
  const [token, setToken] = useState('')
  const [accountId, setAccountId] = useState('')
  const [showTunnelForm, setShowTunnelForm] = useState(false)
  const [tunnelName, setTunnelName] = useState('')
  const [tunnelSecret, setTunnelSecret] = useState('')

  const { data: zones, isLoading: zonesLoading } = useQuery({
    queryKey: ['cf-zones'],
    queryFn: getZones,
    retry: false,
  })
  const { data: tunnels, isLoading: tunnelsLoading } = useQuery({
    queryKey: ['cf-tunnels'],
    queryFn: getTunnels,
    retry: false,
  })

  const saveTokenMut = useMutation({
    mutationFn: ({ token, accountId }: { token: string; accountId: string }) => saveCloudflareToken(token, accountId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cf-zones'] })
      qc.invalidateQueries({ queryKey: ['cf-tunnels'] })
      setToken('')
      setAccountId('')
    },
  })

  const createTunnelMut = useMutation({
    mutationFn: () => createTunnel(tunnelName, tunnelSecret),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cf-tunnels'] })
      setShowTunnelForm(false)
      setTunnelName('')
      setTunnelSecret('')
    },
  })

  const hasData = !!zones || !!tunnels

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* API token card */}
      <div className="bg-card border border-border rounded-xl p-5 mb-5 animate-fade-up">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-7 h-7 rounded-lg bg-muted border border-border flex items-center justify-center">
            <Key size={13} className="text-muted-foreground" />
          </div>
          <h3 className="text-sm font-semibold text-foreground">API Credentials</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
          <input type="password" value={token} onChange={e => setToken(e.target.value)}
            placeholder="Cloudflare API token" className="input-field mono" />
          <input value={accountId} onChange={e => setAccountId(e.target.value)}
            placeholder="Account ID" className="input-field mono" />
        </div>
        <button
          onClick={() => saveTokenMut.mutate({ token, accountId })}
          disabled={!token || !accountId || saveTokenMut.isPending}
          className="px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition-all"
        >
          {saveTokenMut.isPending ? 'Saving…' : 'Save Credentials'}
        </button>
        {saveTokenMut.isSuccess && <p className="text-accent text-xs mt-2.5">Credentials saved — data refreshed.</p>}
        {saveTokenMut.error && <p className="text-destructive text-xs mt-2.5">{(saveTokenMut.error as any).response?.data?.message}</p>}
      </div>

      {!hasData && !zonesLoading && !tunnelsLoading ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <CloudflareIcon size={40} />
          <p className="text-sm opacity-50">Save your Cloudflare credentials to see zones and tunnels.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-fade-up">
          {/* Zones */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border">
              <Globe size={15} className="text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Zones / Domains</h3>
              {zones && (
                <span className="ml-auto text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{zones.length}</span>
              )}
            </div>
            {zonesLoading ? (
              <div className="p-5 space-y-2">
                {[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-muted/40 rounded animate-pulse" />)}
              </div>
            ) : !zones?.length ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                <Globe size={28} className="opacity-20" />
                <p className="text-sm">No zones found.</p>
              </div>
            ) : (
              <div className="divide-y divide-border overflow-y-auto" style={{ maxHeight: '380px' }}>
                {zones.map(z => (
                  <div key={z.id} className="px-5 py-3.5 flex items-center gap-3 hover:bg-muted/20 transition-colors">
                    <CloudflareIcon size={20} />
                    <span className="text-sm font-medium text-foreground flex-1 truncate">{z.name}</span>
                    <div className="flex items-center gap-1.5">
                      <StatusDot status={z.status === 'active' ? 'RUNNING' : 'STOPPED'} />
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${z.status === 'active' ? 'status-online' : 'status-muted'}`}>
                        {z.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Tunnels */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border">
              <Wifi size={15} className="text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Tunnels</h3>
              {tunnels && (
                <span className="ml-auto text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{tunnels.length}</span>
              )}
              <button
                onClick={() => setShowTunnelForm(true)}
                className="flex items-center gap-1 text-xs px-2.5 py-1 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-all font-semibold"
              >
                <Plus size={11} /> New
              </button>
            </div>
            {tunnelsLoading ? (
              <div className="p-5 space-y-2">
                {[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-muted/40 rounded animate-pulse" />)}
              </div>
            ) : !tunnels?.length ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                <Wifi size={28} className="opacity-20" />
                <p className="text-sm">No tunnels found.</p>
                <button onClick={() => setShowTunnelForm(true)} className="text-xs text-primary hover:underline flex items-center gap-1">
                  <Plus size={11} /> Create your first tunnel
                </button>
              </div>
            ) : (
              <div className="divide-y divide-border overflow-y-auto" style={{ maxHeight: '380px' }}>
                {tunnels.map(t => (
                  <div key={t.id} className="px-5 py-3.5 flex items-center gap-3 hover:bg-muted/20 transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-muted border border-border flex items-center justify-center shrink-0">
                      <Wifi size={13} className="text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{t.name}</p>
                      <p className="text-[11px] text-muted-foreground font-mono truncate">{t.id}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <StatusDot status={t.status === 'active' ? 'RUNNING' : 'STOPPED'} />
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${t.status === 'active' ? 'status-online' : 'status-muted'}`}>
                        {t.status ?? 'unknown'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create tunnel modal */}
      {showTunnelForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl animate-fade-up">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-foreground">Create Tunnel</h3>
              <button onClick={() => setShowTunnelForm(false)} className="text-muted-foreground hover:text-foreground"><X size={18}/></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Tunnel Name</label>
                <input value={tunnelName} onChange={e => setTunnelName(e.target.value)}
                  placeholder="my-tunnel" className="input-field" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Tunnel Secret</label>
                <input type="password" value={tunnelSecret} onChange={e => setTunnelSecret(e.target.value)}
                  placeholder="Base64-encoded secret (32+ chars)" className="input-field mono" />
              </div>
              {createTunnelMut.error && <p className="text-destructive text-xs">{(createTunnelMut.error as any).response?.data?.message}</p>}
              <div className="flex gap-2 pt-1">
                <button onClick={() => setShowTunnelForm(false)}
                  className="flex-1 py-2.5 border border-border text-foreground text-sm rounded-lg hover:bg-muted transition-colors">Cancel</button>
                <button onClick={() => createTunnelMut.mutate()} disabled={!tunnelName || !tunnelSecret || createTunnelMut.isPending}
                  className="flex-1 py-2.5 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition-all">
                  {createTunnelMut.isPending ? 'Creating…' : 'Create Tunnel'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
