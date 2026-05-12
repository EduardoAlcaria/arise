import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { EcsCluster } from '../api/aws'
import {
  listEc2Instances, listS3Buckets, listEcsClusters, listEcsServices,
  startInstance, stopInstance, terminateInstance, listTraces, getTopology,
} from '../api/aws'
import { listAwsAccounts, createAwsAccount, updateAwsAccount, deleteAwsAccount, ssoLogin } from '../api/awsAccounts'
import type { AwsAccountResponse } from '../api/awsAccounts'
import {
  Server, HardDrive, Box, Play, Square, Trash2, ChevronDown, ChevronRight,
  AlertTriangle, Loader2, RefreshCw, Plus, X, CheckCircle, Network,
  Activity, Key, Pencil, LogIn, ExternalLink, Copy,
} from 'lucide-react'

const REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'eu-west-1', 'eu-west-2', 'eu-central-1',
  'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'sa-east-1',
]

function stateColor(state: string) {
  if (state === 'running') return 'status-online'
  if (state === 'stopped') return 'status-muted'
  if (state === 'terminated') return 'text-destructive/70 bg-destructive/10 border-destructive/20'
  return 'status-muted'
}

// ── Account card ─────────────────────────────────────────────────────────────

function AccountCard({ account, selected, onSelect, onEdit, onSsoLogin, onDelete }: {
  account: AwsAccountResponse
  selected: boolean
  onSelect: () => void
  onEdit: () => void
  onSsoLogin: () => void
  onDelete: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={`text-left bg-card border rounded-xl px-4 py-3 flex items-center gap-3 transition-all hover:border-primary/50 ${selected ? 'border-primary' : 'border-border'}`}
    >
      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
        <HardDrive size={14} className="text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">{account.name}</p>
        <p className="text-[11px] text-muted-foreground font-mono truncate">{account.profileName} · {account.defaultRegion}</p>
        {account.accountId && <p className="text-[11px] text-muted-foreground font-mono">Account: {account.accountId}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {account.reachable
          ? <CheckCircle size={14} className="text-green-400" />
          : <button
              onClick={e => { e.stopPropagation(); onSsoLogin() }}
              className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border text-destructive border-destructive/30 bg-destructive/5 hover:bg-destructive/15 transition-colors"
              title="SSO token expired — click to login"
            >
              <LogIn size={10} />Login
            </button>}
        <button
          onClick={e => { e.stopPropagation(); onSsoLogin() }}
          className="p-1 rounded text-muted-foreground hover:text-primary transition-colors"
          title="Refresh SSO token"
        >
          <LogIn size={12} />
        </button>
        <button
          onClick={e => { e.stopPropagation(); onEdit() }}
          className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
          title="Edit account"
        >
          <Pencil size={12} />
        </button>
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors"
          title="Delete account"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </button>
  )
}

// ── SSO login modal ───────────────────────────────────────────────────────────

function SsoLoginModal({ account, onClose }: { account: AwsAccountResponse; onClose: () => void }) {
  const qc = useQueryClient()
  const [copied, setCopied] = useState(false)
  const mut = useMutation({
    mutationFn: () => ssoLogin(account.id),
  })

  const copy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-xl">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">AWS SSO Login — {account.profileName}</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors"><X size={16} /></button>
        </div>
        <div className="px-5 py-5 flex flex-col gap-4">
          {!mut.data && !mut.isPending && !mut.isError && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">Click below to start the SSO login flow. A URL and verification code will appear — open the URL in your browser and enter the code.</p>
              <button
                onClick={() => mut.mutate()}
                className="flex items-center justify-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 transition-all"
              >
                <LogIn size={14} />Start SSO Login
              </button>
            </div>
          )}

          {mut.isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
              <Loader2 size={15} className="animate-spin" />Starting SSO login…
            </div>
          )}

          {mut.isError && (
            <div className="flex gap-2 items-start rounded-lg px-3 py-2 text-xs text-destructive border border-destructive/20 bg-destructive/5">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              {(mut.error as any)?.response?.data?.message ?? (mut.error as any)?.message ?? 'Failed to start SSO login'}
            </div>
          )}

          {mut.data && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">1. Open this URL in your browser</p>
                <div className="flex items-center gap-2 bg-muted/40 rounded-lg px-3 py-2 border border-border">
                  <code className="text-xs text-foreground flex-1 break-all">{mut.data.url}</code>
                  <div className="flex gap-1 shrink-0">
                    <a href={mut.data.url} target="_blank" rel="noopener noreferrer" className="p-1 text-muted-foreground hover:text-foreground transition-colors"><ExternalLink size={12} /></a>
                    <button onClick={() => copy(mut.data!.url)} className="p-1 text-muted-foreground hover:text-foreground transition-colors"><Copy size={12} /></button>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">2. Enter this code</p>
                <div className="flex items-center gap-3 bg-muted/40 rounded-lg px-3 py-2 border border-border">
                  <code className="text-xl font-bold tracking-widest text-foreground flex-1 font-mono">{mut.data.code}</code>
                  <button onClick={() => copy(mut.data!.code)} className="p-1 text-muted-foreground hover:text-foreground transition-colors"><Copy size={12} /></button>
                </div>
                {copied && <p className="text-[11px] text-green-400">Copied!</p>}
              </div>
              <p className="text-xs text-muted-foreground">Once you approve in the browser, the token is written automatically. Close this dialog and try your AWS request again.</p>
              <button
                onClick={() => { qc.invalidateQueries({ queryKey: ['aws-accounts'] }); onClose() }}
                className="px-4 py-2 text-sm font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-all"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Register modal ────────────────────────────────────────────────────────────

function RegisterModal({ onClose, editing }: { onClose: () => void; editing?: AwsAccountResponse }) {
  const qc = useQueryClient()
  const [name, setName] = useState(editing?.name ?? '')
  const [profileName, setProfileName] = useState(editing?.profileName ?? '')
  const [region, setRegion] = useState(editing?.defaultRegion ?? 'us-east-1')
  const [terraformRepoUrl, setTerraformRepoUrl] = useState(editing?.terraformRepoUrl ?? '')

  const isEdit = editing != null

  const mut = useMutation({
    mutationFn: () => isEdit
      ? updateAwsAccount(editing.id, { name, profileName, region, terraformRepoUrl: terraformRepoUrl || undefined })
      : createAwsAccount({ name, profileName, region, terraformRepoUrl: terraformRepoUrl || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['aws-accounts'] })
      onClose()
    },
  })

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-xl">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">{isEdit ? 'Edit AWS Account' : 'Register AWS Account'}</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors"><X size={16} /></button>
        </div>
        <div className="px-5 py-5 flex flex-col gap-4">
          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Account Name *</label>
            <input className="input-field" value={name} onChange={e => setName(e.target.value)} placeholder="Production" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">AWS Profile *</label>
            <div className="relative">
              <Key size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input className="input-field mono" style={{ paddingLeft: '32px' }} value={profileName} onChange={e => setProfileName(e.target.value)} placeholder="DEVAccess-123456789" />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Profile name from your <code className="font-mono text-[10px]">~/.aws/config</code>. Run <code className="font-mono text-[10px]">aws sso login --profile &lt;name&gt;</code> first.</p>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Default Region *</label>
            <select className="input-field" value={region} onChange={e => setRegion(e.target.value)}>
              {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-widest">Terraform Repo URL</label>
            <input className="input-field mono" value={terraformRepoUrl} onChange={e => setTerraformRepoUrl(e.target.value)} placeholder="https://github.com/org/infra-terraform.git (optional)" />
            <p className="text-[11px] text-muted-foreground mt-1">Optional. Used to enrich topology with declared infrastructure.</p>
          </div>

          {mut.isError && (
            <div className="flex gap-2 items-center rounded-lg px-3 py-2 text-xs text-destructive border border-destructive/20 bg-destructive/5">
              <AlertTriangle size={12} className="shrink-0" />
              {(mut.error as any)?.response?.data?.message ?? (mut.error as any)?.message ?? (isEdit ? 'Failed to update' : 'Failed to register')}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
            <button
              onClick={() => mut.mutate()}
              disabled={mut.isPending || !name.trim() || !profileName.trim()}
              className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition-all"
            >
              {mut.isPending
                ? <><Loader2 size={13} className="animate-spin" />{isEdit ? 'Saving…' : 'Registering…'}</>
                : isEdit ? <><Pencil size={13} />Save Changes</> : <><Plus size={13} />Register</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── EC2 tab ───────────────────────────────────────────────────────────────────

function Ec2Tab({ accountId, region }: { accountId: number; region: string }) {
  const qc = useQueryClient()
  const [confirmTerminate, setConfirmTerminate] = useState<string | null>(null)

  const { data: instances, isLoading, error, refetch } = useQuery({
    queryKey: ['ec2-instances', accountId, region],
    queryFn: () => listEc2Instances(accountId, region),
  })

  const startMut = useMutation({
    mutationFn: (id: string) => startInstance(accountId, id, region),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ec2-instances', accountId, region] }),
  })
  const stopMut = useMutation({
    mutationFn: (id: string) => stopInstance(accountId, id, region),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ec2-instances', accountId, region] }),
  })
  const terminateMut = useMutation({
    mutationFn: (id: string) => terminateInstance(accountId, id, region),
    onSuccess: () => { setConfirmTerminate(null); qc.invalidateQueries({ queryKey: ['ec2-instances', accountId, region] }) },
  })

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center"><Loader2 size={16} className="animate-spin" />Loading instances…</div>
  if (error) return <div className="flex items-center gap-2 text-sm text-destructive py-12 justify-center"><AlertTriangle size={15} />{(error as any)?.response?.data?.message ?? 'Failed to load'}</div>
  if (!instances?.length) return <div className="text-sm text-muted-foreground py-12 text-center">No EC2 instances in {region}</div>

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <button onClick={() => refetch()} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw size={12} />Refresh
        </button>
      </div>
      {instances.map(inst => (
        <div key={inst.instanceId} className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5"><Server size={14} className="text-muted-foreground" /></div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{inst.name ?? inst.instanceId}</p>
                <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{inst.instanceId} · {inst.instanceType}</p>
                <div className="flex flex-wrap gap-3 mt-1.5 text-[11px] text-muted-foreground">
                  {inst.publicIp && <span>Public: <span className="font-mono text-foreground">{inst.publicIp}</span></span>}
                  {inst.privateIp && <span>Private: <span className="font-mono text-foreground">{inst.privateIp}</span></span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${stateColor(inst.state)}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-current" />{inst.state}
              </span>
              {inst.state === 'stopped' && (
                <button onClick={() => startMut.mutate(inst.instanceId)} disabled={startMut.isPending}
                  className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20 disabled:opacity-50 transition-all">
                  {startMut.isPending ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}Start
                </button>
              )}
              {inst.state === 'running' && (
                <button onClick={() => stopMut.mutate(inst.instanceId)} disabled={stopMut.isPending}
                  className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-muted text-muted-foreground border border-border hover:bg-muted/70 disabled:opacity-50 transition-all">
                  {stopMut.isPending ? <Loader2 size={10} className="animate-spin" /> : <Square size={10} />}Stop
                </button>
              )}
              {inst.state !== 'terminated' && (
                confirmTerminate === inst.instanceId ? (
                  <div className="flex items-center gap-1">
                    <button onClick={() => terminateMut.mutate(inst.instanceId)} disabled={terminateMut.isPending}
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20 disabled:opacity-50 transition-all">
                      {terminateMut.isPending ? <Loader2 size={10} className="animate-spin" /> : 'Confirm'}
                    </button>
                    <button onClick={() => setConfirmTerminate(null)} className="text-[11px] text-muted-foreground hover:text-foreground px-2">Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmTerminate(inst.instanceId)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Terminate instance">
                    <Trash2 size={12} />
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── S3 tab ────────────────────────────────────────────────────────────────────

function S3Tab({ accountId }: { accountId: number }) {
  const { data: buckets, isLoading, error } = useQuery({
    queryKey: ['s3-buckets', accountId],
    queryFn: () => listS3Buckets(accountId),
  })
  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center"><Loader2 size={16} className="animate-spin" />Loading…</div>
  if (error) return <div className="flex items-center gap-2 text-sm text-destructive py-12 justify-center"><AlertTriangle size={15} />{(error as any)?.response?.data?.message ?? 'Failed to load'}</div>
  if (!buckets?.length) return <div className="text-sm text-muted-foreground py-12 text-center">No S3 buckets</div>
  return (
    <div className="flex flex-col gap-2">
      {buckets.map(b => (
        <div key={b.name} className="bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0"><Box size={13} className="text-muted-foreground" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground font-mono truncate">{b.name}</p>
            {b.creationDate && <p className="text-[11px] text-muted-foreground mt-0.5">Created {new Date(b.creationDate).toLocaleDateString()}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── ECS tab ───────────────────────────────────────────────────────────────────

function EcsClusterRow({ accountId, cluster }: { accountId: number; cluster: EcsCluster }) {
  const [open, setOpen] = useState(false)
  const { data: services, isLoading } = useQuery({
    queryKey: ['ecs-services', accountId, cluster.clusterArn],
    queryFn: () => listEcsServices(accountId, cluster.clusterArn, cluster.region),
    enabled: open,
  })
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button onClick={() => setOpen(v => !v)} className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors">
        <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0"><Server size={13} className="text-muted-foreground" /></div>
        <div className="flex-1 text-left min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{cluster.clusterName}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{cluster.activeServicesCount} services · {cluster.runningTasksCount} running</p>
        </div>
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border mr-2 ${cluster.status === 'ACTIVE' ? 'status-online' : 'status-muted'}`}>{cluster.status}</span>
        {open ? <ChevronDown size={14} className="text-muted-foreground shrink-0" /> : <ChevronRight size={14} className="text-muted-foreground shrink-0" />}
      </button>
      {open && (
        <div className="border-t border-border px-4 py-3 flex flex-col gap-2">
          {isLoading && <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" />Loading services…</div>}
          {!isLoading && !services?.length && <p className="text-xs text-muted-foreground">No services</p>}
          {services?.map(svc => (
            <div key={svc.serviceArn} className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors ${svc.runningCount < svc.desiredCount ? 'border-destructive/40 bg-destructive/5' : 'bg-muted/30 border-transparent'}`}>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{svc.serviceName}</p>
                <p className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">{svc.taskDefinition.split('/').pop()}</p>
              </div>
              <div className={`text-[11px] shrink-0 font-mono ${svc.runningCount < svc.desiredCount ? 'text-destructive' : 'text-muted-foreground'}`}>{svc.runningCount}/{svc.desiredCount}</div>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${svc.status === 'ACTIVE' ? 'status-online' : 'status-muted'}`}>{svc.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function EcsTab({ accountId, region }: { accountId: number; region: string }) {
  const { data: clusters, isLoading, error } = useQuery({
    queryKey: ['ecs-clusters', accountId, region],
    queryFn: () => listEcsClusters(accountId, region),
  })
  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center"><Loader2 size={16} className="animate-spin" />Loading…</div>
  if (error) return <div className="flex items-center gap-2 text-sm text-destructive py-12 justify-center"><AlertTriangle size={15} />{(error as any)?.response?.data?.message ?? 'Failed to load'}</div>
  if (!clusters?.length) return <div className="text-sm text-muted-foreground py-12 text-center">No ECS clusters in {region}</div>
  return <div className="flex flex-col gap-3">{clusters.map(c => <EcsClusterRow key={c.clusterArn} accountId={accountId} cluster={c} />)}</div>
}

// ── Topology tab ──────────────────────────────────────────────────────────────

function TopologyTab({ accountId, region }: { accountId: number; region: string }) {
  const { data: topo, isLoading, error } = useQuery({
    queryKey: ['topology', accountId, region],
    queryFn: () => getTopology(accountId, region),
  })
  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center"><Loader2 size={16} className="animate-spin" />Building topology…</div>
  if (error) return <div className="flex items-center gap-2 text-sm text-destructive py-12 justify-center"><AlertTriangle size={15} />{(error as any)?.response?.data?.message ?? 'Failed to load'}</div>
  if (!topo?.nodes?.length) return <div className="text-sm text-muted-foreground py-12 text-center">No topology data in {region}</div>

  const byService = topo.nodes.reduce((acc: Record<string, number>, n) => {
    const svc = n.service as string
    acc[svc] = (acc[svc] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Object.entries(byService).map(([svc, count]) => (
          <div key={svc} className="bg-card border border-border rounded-xl px-4 py-3">
            <p className="text-lg font-bold text-foreground">{count}</p>
            <p className="text-xs text-muted-foreground capitalize">{svc.replace('_', ' ')}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {topo.nodes.slice(0, 20).map(n => (
          <div key={n.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-xs ${n.source === 'terraform' ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/20'}`}>
            <Network size={11} className="text-muted-foreground shrink-0" />
            <span className="font-medium text-foreground truncate flex-1">{n.label as string}</span>
            <span className="text-muted-foreground capitalize shrink-0">{n.service as string}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${n.source === 'terraform' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>{n.source as string}</span>
          </div>
        ))}
        {topo.nodes.length > 20 && <p className="text-xs text-muted-foreground text-center">{topo.nodes.length - 20} more resources…</p>}
      </div>
    </div>
  )
}

// ── Traces tab ────────────────────────────────────────────────────────────────

function TracesTab({ accountId, region }: { accountId: number; region: string }) {
  const [minutes, setMinutes] = useState(60)
  const { data: traces, isLoading, error } = useQuery({
    queryKey: ['traces', accountId, region, minutes],
    queryFn: () => listTraces(accountId, region, minutes),
  })
  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center"><Loader2 size={16} className="animate-spin" />Loading traces…</div>
  if (error) return <div className="flex items-center gap-2 text-sm text-destructive py-12 justify-center"><AlertTriangle size={15} />{(error as any)?.response?.data?.message ?? 'X-Ray not available or no traces'}</div>
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <select value={minutes} onChange={e => setMinutes(Number(e.target.value))} className="input-field text-xs py-1.5 w-auto">
          <option value={15}>Last 15 min</option>
          <option value={60}>Last 1 hour</option>
          <option value={360}>Last 6 hours</option>
        </select>
        <span className="text-xs text-muted-foreground">{traces?.length ?? 0} traces</span>
      </div>
      {!traces?.length && <div className="text-sm text-muted-foreground py-12 text-center">No X-Ray traces found</div>}
      {traces?.map(t => (
        <div key={t.id} className={`bg-card border rounded-xl px-4 py-3 flex items-center gap-3 ${t.hasFault || t.hasError ? 'border-destructive/40' : 'border-border'}`}>
          <Activity size={14} className={`shrink-0 ${t.hasFault || t.hasError ? 'text-destructive' : 'text-muted-foreground'}`} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-mono text-foreground truncate">{t.method && t.url ? `${t.method} ${t.url}` : t.id}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{t.serviceCount} services · {t.duration?.toFixed(2)}s</p>
          </div>
          {(t.hasFault || t.hasError) && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border text-destructive border-destructive/30 bg-destructive/10 shrink-0">
              {t.hasFault ? 'Fault' : 'Error'}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = 'ec2' | 's3' | 'ecs' | 'topology' | 'traces'

export default function AWS() {
  const qc = useQueryClient()
  const [showRegister, setShowRegister] = useState(false)
  const [editingAccount, setEditingAccount] = useState<AwsAccountResponse | null>(null)
  const [ssoLoginAccount, setSsoLoginAccount] = useState<AwsAccountResponse | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [tab, setTab] = useState<Tab>('ec2')
  const [region, setRegion] = useState('us-east-1')

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['aws-accounts'],
    queryFn: listAwsAccounts,
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteAwsAccount(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['aws-accounts'] })
      setSelectedId(null)
    },
  })

  const selected = accounts?.find(a => a.id === selectedId) ?? accounts?.[0] ?? null
  const effectiveId = selected?.id ?? null

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground p-12 justify-center"><Loader2 size={16} className="animate-spin" />Loading…</div>

  const tabs: { id: Tab; label: string }[] = [
    { id: 'ec2', label: 'EC2' },
    { id: 's3', label: 'S3' },
    { id: 'ecs', label: 'ECS' },
    { id: 'topology', label: 'Topology' },
    { id: 'traces', label: 'Traces' },
  ]

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {showRegister && <RegisterModal onClose={() => setShowRegister(false)} />}
      {editingAccount && <RegisterModal editing={editingAccount} onClose={() => setEditingAccount(null)} />}
      {ssoLoginAccount && <SsoLoginModal account={ssoLoginAccount} onClose={() => setSsoLoginAccount(null)} />}

      {/* Account list */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-semibold text-foreground">AWS</h1>
          <button
            onClick={() => setShowRegister(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:opacity-90 transition-all"
          >
            <Plus size={12} />Register Account
          </button>
        </div>
        {!accounts?.length ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center border border-dashed border-border rounded-xl">
            <HardDrive size={28} className="text-muted-foreground opacity-40" />
            <div>
              <p className="text-sm font-semibold text-foreground">No AWS accounts</p>
              <p className="text-xs text-muted-foreground mt-1">Register an account using your AWS SSO profile.</p>
            </div>
            <button onClick={() => setShowRegister(true)} className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 transition-all mt-1">
              <Plus size={13} />Register Account
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {accounts.map(a => (
              <AccountCard
                key={a.id}
                account={a}
                selected={selected?.id === a.id}
                onSelect={() => setSelectedId(a.id)}
                onEdit={() => setEditingAccount(a)}
                onSsoLogin={() => setSsoLoginAccount(a)}
                onDelete={() => deleteMut.mutate(a.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Selected account detail */}
      {effectiveId !== null && (
        <>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div className="flex gap-1 bg-muted/50 rounded-lg p-1 border border-border">
              {tabs.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${tab === t.id ? 'bg-card text-foreground shadow-sm border border-border' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {tab !== 's3' && tab !== 'topology' && tab !== 'traces' && (
              <select value={region} onChange={e => setRegion(e.target.value)} className="input-field text-xs py-1.5 w-auto">
                {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            )}
          </div>

          {tab === 'ec2' && <Ec2Tab accountId={effectiveId} region={region} />}
          {tab === 's3' && <S3Tab accountId={effectiveId} />}
          {tab === 'ecs' && <EcsTab accountId={effectiveId} region={region} />}
          {tab === 'topology' && <TopologyTab accountId={effectiveId} region={selected?.defaultRegion ?? region} />}
          {tab === 'traces' && <TracesTab accountId={effectiveId} region={region} />}
        </>
      )}
    </div>
  )
}
