import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { connectInfisical, getInfisicalStatus } from '../api/infisical'
import { saveCloudflareToken, getCloudflareStatus } from '../api/cloudflare'
import { Database, Check, AlertTriangle, Loader2, Link2Off, Cloud, Key } from 'lucide-react'

export default function Settings() {
  // Infisical state
  const [baseUrl, setBaseUrl] = useState('https://app.infisical.com')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [projectId, setProjectId] = useState('')
  const [infisicalSaveSuccess, setInfisicalSaveSuccess] = useState(false)

  // Cloudflare state
  const [cfToken, setCfToken] = useState('')
  const [cfAccountId, setCfAccountId] = useState('')
  const [cfSaveSuccess, setCfSaveSuccess] = useState(false)

  const { data: infisicalStatus, refetch: refetchInfisical } = useQuery({
    queryKey: ['infisical-status'],
    queryFn: getInfisicalStatus,
    retry: false,
    staleTime: 30_000,
  })

  const { data: cfStatus, refetch: refetchCf } = useQuery({
    queryKey: ['cloudflare-status'],
    queryFn: getCloudflareStatus,
    retry: false,
    staleTime: 30_000,
  })

  const connectMut = useMutation({
    mutationFn: connectInfisical,
    onSuccess: () => {
      setInfisicalSaveSuccess(true)
      refetchInfisical()
      setTimeout(() => setInfisicalSaveSuccess(false), 3000)
    },
  })

  const saveCfMut = useMutation({
    mutationFn: ({ token, accountId }: { token: string; accountId: string }) =>
      saveCloudflareToken(token, accountId),
    onSuccess: () => {
      setCfSaveSuccess(true)
      refetchCf()
      setCfToken('')
      setCfAccountId('')
      setTimeout(() => setCfSaveSuccess(false), 3000)
    },
  })

  const handleInfisicalSave = () => {
    if (!clientId.trim() || !clientSecret.trim()) return
    connectMut.mutate({
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
      baseUrl: baseUrl.trim() || undefined,
      projectId: projectId.trim() || undefined,
    })
  }

  const handleCfSave = () => {
    if (!cfToken.trim() || !cfAccountId.trim()) return
    saveCfMut.mutate({ token: cfToken.trim(), accountId: cfAccountId.trim() })
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-foreground mb-1">Settings</h1>
        <p className="text-sm text-muted-foreground">Configure integrations and preferences.</p>
      </div>

      <div className="flex flex-col gap-5">
        {/* Cloudflare section */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <Cloud size={15} className="text-foreground" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Cloudflare</p>
              <p className="text-xs text-muted-foreground">API token for tunnel creation and DNS management</p>
            </div>
            {cfStatus ? (
              cfStatus.configured ? (
                <span className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full status-online">
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                  Configured
                </span>
              ) : (
                <span className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full status-muted">
                  <Link2Off size={11} />
                  Not configured
                </span>
              )
            ) : null}
          </div>

          <div className="px-5 py-5 flex flex-col gap-4">
            {cfStatus?.configured && !cfSaveSuccess && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-lg border border-border bg-muted/20">
                <Check size={14} className="text-green-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-foreground">Token saved</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Re-enter below to update credentials.</p>
                </div>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">API Token *</label>
              <div className="relative">
                <Key size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="password"
                  className="input-field mono"
                  style={{ paddingLeft: '32px' }}
                  value={cfToken}
                  onChange={e => setCfToken(e.target.value)}
                  placeholder="••••••••••••••••••••"
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Create at dash.cloudflare.com → My Profile → API Tokens. Needs <code className="font-mono text-[10px]">Account:Cloudflare Tunnel:Edit</code> + <code className="font-mono text-[10px]">Zone:DNS:Edit</code> permissions.
              </p>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Account ID *</label>
              <input
                className="input-field mono"
                value={cfAccountId}
                onChange={e => setCfAccountId(e.target.value)}
                placeholder="your-account-id"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Found in the right sidebar of any Cloudflare dashboard page.</p>
            </div>

            {saveCfMut.isError && (
              <div className="flex gap-2 items-center rounded-lg px-3 py-2 text-xs text-destructive border border-destructive/20 bg-destructive/5">
                <AlertTriangle size={12} className="shrink-0" />
                {(saveCfMut.error as any)?.response?.data?.message ?? (saveCfMut.error as any)?.message ?? 'Failed to save'}
              </div>
            )}

            {cfSaveSuccess && (
              <div className="flex gap-2 items-center rounded-lg px-3 py-2 text-xs border border-current bg-current/5 status-online">
                <Check size={12} className="shrink-0" />
                Cloudflare credentials saved
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button
                onClick={handleCfSave}
                disabled={saveCfMut.isPending || !cfToken.trim() || !cfAccountId.trim()}
                className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition-all"
              >
                {saveCfMut.isPending
                  ? <><Loader2 size={13} className="animate-spin" />Saving…</>
                  : <><Cloud size={13} />Save Credentials</>
                }
              </button>
            </div>
          </div>
        </div>

        {/* Infisical section */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <Database size={15} className="text-foreground" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Infisical</p>
              <p className="text-xs text-muted-foreground">Secrets management integration</p>
            </div>
            {infisicalStatus ? (
              infisicalStatus.connected ? (
                <span className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full status-online">
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                  Connected
                </span>
              ) : (
                <span className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full status-muted">
                  <Link2Off size={11} />
                  Not connected
                </span>
              )
            ) : null}
          </div>

          <div className="px-5 py-5 flex flex-col gap-4">
            {infisicalStatus?.connected && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-lg border border-border bg-muted/20">
                <Check size={14} className="text-green-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-foreground">Currently connected</p>
                  {infisicalStatus.baseUrl && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">{infisicalStatus.baseUrl}</p>
                  )}
                  {infisicalStatus.projectId && (
                    <p className="text-[11px] text-muted-foreground font-mono">Project: {infisicalStatus.projectId}</p>
                  )}
                </div>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Base URL</label>
              <input
                className="input-field"
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                placeholder="https://app.infisical.com"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Leave default for Infisical Cloud, or enter your self-hosted URL.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Client ID *</label>
                <input
                  className="input-field mono"
                  value={clientId}
                  onChange={e => setClientId(e.target.value)}
                  placeholder="client_id_xxxx"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Client Secret *</label>
                <input
                  className="input-field mono"
                  type="password"
                  value={clientSecret}
                  onChange={e => setClientSecret(e.target.value)}
                  placeholder="••••••••••••"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Project ID</label>
              <input
                className="input-field mono"
                value={projectId}
                onChange={e => setProjectId(e.target.value)}
                placeholder="project_xxxx (optional)"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Default project to load secrets from. Can be overridden per deployment.</p>
            </div>

            {connectMut.isError && (
              <div className="flex gap-2 items-center rounded-lg px-3 py-2 text-xs text-destructive border border-destructive/20 bg-destructive/5">
                <AlertTriangle size={12} className="shrink-0" />
                {(connectMut.error as any)?.message ?? 'Failed to connect'}
              </div>
            )}

            {infisicalSaveSuccess && (
              <div className="flex gap-2 items-center rounded-lg px-3 py-2 text-xs border border-current bg-current/5 status-online">
                <Check size={12} className="shrink-0" />
                Connected successfully
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button
                onClick={handleInfisicalSave}
                disabled={connectMut.isPending || !clientId.trim() || !clientSecret.trim()}
                className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition-all"
              >
                {connectMut.isPending
                  ? <><Loader2 size={13} className="animate-spin" />Connecting…</>
                  : <><Database size={13} />Save & Connect</>
                }
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
