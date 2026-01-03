import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { EcsCluster } from '../api/aws'
import {
  listEc2Instances, listS3Buckets, listEcsClusters, listEcsServices,
  startInstance, stopInstance, terminateInstance, listTraces, getTopology,
  getExplorer, evictAwsCache,
} from '../api/aws'
import { listAwsAccounts, createAwsAccount, updateAwsAccount, deleteAwsAccount, ssoLogin } from '../api/awsAccounts'
import type { AwsAccountResponse } from '../api/awsAccounts'
import type { AwsExplorerResponse, VpcSummary } from '../types'
import {
  Server, HardDrive, Box, Play, Square, Trash2, ChevronDown, ChevronRight,
  AlertTriangle, Loader2, RefreshCw, Plus, X, CheckCircle, Network,
  Activity, Key, Pencil, LogIn, ExternalLink, Copy, Search, Zap,
} from 'lucide-react'
import {
  ReactFlow, Background, BackgroundVariant, Controls, MiniMap, Panel,
  Handle, Position, useNodesState, useEdgesState, MarkerType,
  type Node, type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

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

const GRP_PAD  = 18
const GRP_HEAD = 40
const NODE_W   = 230
const NODE_H   = 82
const NODE_GAP = 12
const SUB_GAP  = 16
const FREE_GAP = 60

const GRP_ID = (id: string) => `grp::${id}`

// Group node — renders a labeled container for VPCs and subnets
function AwsGroupNode({ data, selected }: { data: any; selected?: boolean }) {
  const color = awsSvcColor(data.service)
  const Icon  = awsSvcIcon(data.service)
  return (
    <div style={{
      width: '100%', height: '100%',
      border: `1.5px dashed ${selected ? color : color + '55'}`,
      borderRadius: 14,
      background: color + '06',
      boxSizing: 'border-box',
      pointerEvents: 'none',
    }}>
      <div style={{
        position: 'absolute', top: 11, left: 14,
        display: 'flex', alignItems: 'center', gap: 6, pointerEvents: 'none',
      }}>
        <Icon size={11} style={{ color, flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          {data.label}
        </span>
        {data.cidr && (
          <span style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
            {data.cidr}
          </span>
        )}
        {data.az && (
          <span style={{ fontSize: 10, color: '#475569', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
            · {data.az}
          </span>
        )}
      </div>
    </div>
  )
}

// Groups nodes by VPC → subnet → EC2 hierarchy using edge relationships.
// Lambda / ECS / S3 that have no VPC parent float above the groups.
function buildGroupedLayout(
  rawNodes: any[],
  rawEdges: any[],
  search: string,
): { nodes: Node[]; edges: Edge[] } {
  const q = search.trim().toLowerCase()
  const childrenOf = new Map<string, string[]>()
  rawEdges.forEach(e => {
    if (!childrenOf.has(e.source)) childrenOf.set(e.source, [])
    childrenOf.get(e.source)!.push(e.target)
  })
  const byId = new Map<string, any>(rawNodes.map(n => [n.id, n]))

  const vpcs    = rawNodes.filter(n => n.service === 'vpc')
  const grouped = new Set(['vpc', 'subnet', 'security_group', 'ec2'])
  const floated = rawNodes.filter(n => !grouped.has(n.service))

  // Suppress containment edges — the visual nesting makes them redundant
  const suppressed = new Set<string>()
  rawEdges.forEach(e => {
    const src = byId.get(e.source)?.service ?? ''
    if (src === 'vpc' || src === 'subnet')
      suppressed.add(e.id ?? `${e.source}->${e.target}`)
  })

  const rfEdges: Edge[] = rawEdges
    .filter(e => !suppressed.has(e.id ?? `${e.source}->${e.target}`))
    .map((e, i) => ({
      id: `e-${i}`, source: e.source, target: e.target,
      type: 'smoothstep', label: e.label,
      labelStyle: { fontSize: 9, fill: '#64748b' },
      labelBgStyle: { fill: '#1c1c1e', fillOpacity: 0.9 },
      labelBgPadding: [3, 2] as [number, number],
      labelBgBorderRadius: 3,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#475569' },
      style: { stroke: '#475569', strokeWidth: 1.5 },
    }))

  const rfNodes: Node[] = []
  let cursorY = 0

  // ── Floated nodes (Lambda, ECS, S3 …) ────────────────────────────────────
  floated.forEach((n, i) => {
    const dimmed = q ? !n.label?.toLowerCase().includes(q) && !n.service?.toLowerCase().includes(q) : false
    rfNodes.push({
      id: n.id, type: 'awsNode',
      position: { x: i * (NODE_W + NODE_GAP), y: 0 },
      data: { ...n, dimmed },
    })
  })
  if (floated.length > 0) cursorY = NODE_H + FREE_GAP

  // ── VPC groups ────────────────────────────────────────────────────────────
  vpcs.forEach(vpc => {
    const subIds = (childrenOf.get(vpc.id) ?? []).filter(id => byId.get(id)?.service === 'subnet')
    const sgIds  = (childrenOf.get(vpc.id) ?? []).filter(id => byId.get(id)?.service === 'security_group')

    // Compute per-subnet dimensions
    type SubLayout = { id: string; x: number; w: number; h: number }
    const subs: SubLayout[] = []
    let sx = GRP_PAD

    subIds.forEach(subId => {
      const ec2Ids = (childrenOf.get(subId) ?? []).filter(id => byId.get(id)?.service === 'ec2')
      const n = ec2Ids.length
      const subW = NODE_W + GRP_PAD * 2
      const subH = GRP_HEAD + (n > 0 ? n * NODE_H + (n - 1) * NODE_GAP : NODE_H) + GRP_PAD
      subs.push({ id: subId, x: sx, w: subW, h: subH })
      sx += subW + SUB_GAP
    })

    const sgColX  = sx + (subs.length > 0 ? GRP_PAD : 0)
    const maxSubH = subs.reduce((m, s) => Math.max(m, s.h), 0)
    const sgColH  = sgIds.length > 0 ? sgIds.length * NODE_H + (sgIds.length - 1) * NODE_GAP : 0
    const innerH  = Math.max(maxSubH, sgColH) || (NODE_H + GRP_PAD)

    const hasSgs = sgIds.length > 0
    const vpcW   = sgColX + (hasSgs ? NODE_W + GRP_PAD : 0) + GRP_PAD
    const vpcH   = GRP_HEAD + innerH + GRP_PAD * 2

    // VPC group node (must appear before children in array)
    rfNodes.push({
      id: GRP_ID(vpc.id), type: 'awsGroup',
      position: { x: 0, y: cursorY },
      style: { width: vpcW, height: vpcH },
      data: { ...vpc },
    })

    // Subnet groups inside VPC
    subs.forEach(({ id: subId, x, w, h }) => {
      const subnet = byId.get(subId)!
      const ec2Ids = (childrenOf.get(subId) ?? []).filter(id => byId.get(id)?.service === 'ec2')

      rfNodes.push({
        id: GRP_ID(subId), type: 'awsGroup',
        parentId: GRP_ID(vpc.id),
        position: { x, y: GRP_HEAD + GRP_PAD },
        style: { width: w, height: h },
        data: { ...subnet },
      })

      ec2Ids.forEach((ec2Id, i) => {
        const ec2 = byId.get(ec2Id)!
        const dimmed = q ? !ec2.label?.toLowerCase().includes(q) : false
        rfNodes.push({
          id: ec2.id, type: 'awsNode',
          parentId: GRP_ID(subId),
          position: { x: GRP_PAD, y: GRP_HEAD + i * (NODE_H + NODE_GAP) },
          data: { ...ec2, dimmed },
        })
      })
    })

    // Security groups inside VPC
    sgIds.forEach((sgId, i) => {
      const sg = byId.get(sgId)!
      const dimmed = q ? !sg.label?.toLowerCase().includes(q) : false
      rfNodes.push({
        id: sg.id, type: 'awsNode',
        parentId: GRP_ID(vpc.id),
        position: { x: sgColX, y: GRP_HEAD + GRP_PAD + i * (NODE_H + NODE_GAP) },
        data: { ...sg, dimmed },
      })
    })

    cursorY += vpcH + FREE_GAP
  })

  return { nodes: rfNodes, edges: rfEdges }
}

function awsSvcColor(svc: string): string {
  const m: Record<string, string> = {
    vpc: '#60a5fa', subnet: '#818cf8', security_group: '#f97316',
    ec2: '#4ade80', lambda: '#facc15', ecs: '#c084fc', s3: '#22d3ee',
  }
  return m[svc] ?? '#6b7280'
}

function awsSvcIcon(svc: string) {
  if (svc === 'ec2') return Server
  if (svc === 'lambda') return Zap
  if (svc === 'ecs') return Box
  if (svc === 's3') return HardDrive
  return Network
}

function AwsNodeCard({ data, selected }: { data: any; selected?: boolean }) {
  const Icon = awsSvcIcon(data.service)
  const color = awsSvcColor(data.service)
  const isTf = data.source === 'terraform'

  const stateVal = data.state ?? data.status
  const stateColor =
    stateVal && ['running', 'available', 'active', 'ACTIVE'].includes(stateVal) ? '#4ade80' :
    stateVal && ['stopped', 'inactive'].includes(stateVal) ? '#f87171' : '#facc15'

  const subtitle =
    data.instanceType ? `${data.instanceType}${data.privateIp ? ' · ' + data.privateIp : ''}` :
    data.cidr ? `${data.cidr}${data.az ? ' · ' + data.az : ''}` :
    data.runtime ? data.runtime :
    data.runningTasksCount != null ? `${data.runningTasksCount} tasks running` : null

  return (
    <>
      <Handle type="target" position={Position.Top}
        style={{ background: color, border: 'none', width: 8, height: 8 }} />
      <div style={{
        background: '#1c1c1e',
        border: `1.5px solid ${selected ? color : isTf ? color + '55' : color + '28'}`,
        borderRadius: 10, padding: '9px 13px', width: 230,
        boxShadow: selected ? `0 0 0 2px ${color}33, 0 4px 20px ${color}22` : '0 2px 8px rgba(0,0,0,0.5)',
        opacity: data.dimmed ? 0.2 : 1,
        transition: 'opacity 0.2s',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
          <Icon size={13} style={{ color, flexShrink: 0, marginTop: 2 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#f1f5f9', wordBreak: 'break-all', lineHeight: 1.3 }}>
              {data.label}
            </div>
            {subtitle && (
              <div style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace', marginTop: 2 }}>{subtitle}</div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
              {stateVal && (
                <>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: stateColor }} />
                  <span style={{ fontSize: 9, color: stateColor, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{stateVal}</span>
                  <span style={{ fontSize: 9, color: '#334155' }}>·</span>
                </>
              )}
              <span style={{
                fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                color: isTf ? '#818cf8' : '#64748b',
              }}>{isTf ? 'tf' : 'live'}</span>
            </div>
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom}
        style={{ background: color, border: 'none', width: 8, height: 8 }} />
    </>
  )
}

const awsNodeTypes = { awsNode: AwsNodeCard, awsGroup: AwsGroupNode }

function TopologyTab({ accountId, region }: { accountId: number; region: string }) {
  const { data: topo, isLoading, error, refetch } = useQuery({
    queryKey: ['topology', accountId, region],
    queryFn: () => getTopology(accountId, region),
  })

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([])
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [selectedNode, setSelectedNode] = useState<any>(null)
  const [search, setSearch] = useState('')
  const [hiddenSvcs, setHiddenSvcs] = useState<Set<string>>(new Set())

  const availableSvcs = useMemo(
    () => topo ? [...new Set(topo.nodes.map(n => n.service))] : [],
    [topo],
  )

  const liveCount = topo?.nodes.filter(n => n.source === 'live').length ?? 0
  const tfCount = topo?.nodes.filter(n => n.source === 'terraform').length ?? 0

  useEffect(() => {
    if (!topo?.nodes) return
    const filtered = topo.nodes.filter(n => !hiddenSvcs.has(n.service))
    const { nodes, edges } = buildGroupedLayout(filtered, topo.edges, search)
    setRfNodes(nodes)
    setRfEdges(edges)
  }, [topo, search, hiddenSvcs])

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center"><Loader2 size={16} className="animate-spin" />Building topology…</div>
  if (error) return <div className="flex items-center gap-2 text-sm text-destructive py-12 justify-center"><AlertTriangle size={15} />{(error as any)?.response?.data?.message ?? 'Failed to load'}</div>
  if (!topo?.nodes?.length) return <div className="text-sm text-muted-foreground py-12 text-center">No topology data in {region}</div>

  return (
    <div style={{ height: 560, position: 'relative', background: '#18181b', borderRadius: 12, overflow: 'hidden', border: '1px solid #27272a' }}>
      <style>{`.aws-topo .react-flow__controls-button{background:#000;border-color:#333;fill:#fff}.aws-topo .react-flow__controls-button:hover{background:#111}`}</style>
      <ReactFlow
        className="aws-topo" nodes={rfNodes} edges={rfEdges}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        nodeTypes={awsNodeTypes}
        onNodeClick={(_, node) => setSelectedNode(node)}
        onPaneClick={() => setSelectedNode(null)}
        fitView fitViewOptions={{ padding: 0.3 }} minZoom={0.08}
        style={{ background: 'transparent' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="#3f3f46" />
        <Controls style={{ background: '#1e293b', border: '1px solid #334155' }} />
        <MiniMap nodeStrokeWidth={3} pannable zoomable style={{ background: '#1e293b', border: '1px solid #334155' }} />
        <Panel position="top-left">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: '#27272a', border: '1px solid #334155', borderRadius: 10, padding: '10px 12px', minWidth: 210, boxShadow: '0 2px 16px rgba(0,0,0,0.5)' }}>
            <div style={{ position: 'relative' }}>
              <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#64748b', pointerEvents: 'none' }} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search nodes…"
                style={{ width: '100%', padding: '5px 8px 5px 26px', background: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 12, color: '#f1f5f9', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {liveCount > 0
                ? <span style={{ fontSize: 10, fontWeight: 700, color: '#4ade80', background: '#4ade8015', padding: '2px 7px', borderRadius: 4 }}>{liveCount} live</span>
                : <span style={{ fontSize: 10, color: '#f87171', background: '#f8717115', padding: '2px 7px', borderRadius: 4 }}>⚠ no live data</span>}
              {tfCount > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: '#818cf8', background: '#818cf815', padding: '2px 7px', borderRadius: 4 }}>{tfCount} tf</span>}
              <button onClick={() => refetch()} title="Refresh" style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>↻</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {availableSvcs.map(svc => {
                const active = !hiddenSvcs.has(svc)
                const Icon = awsSvcIcon(svc)
                const color = awsSvcColor(svc)
                return (
                  <button key={svc} onClick={() => setHiddenSvcs(prev => { const s = new Set(prev); s.has(svc) ? s.delete(svc) : s.add(svc); return s })}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 20, fontSize: 11, fontWeight: 500, border: `1px solid ${active ? color : '#334155'}`, background: active ? color + '20' : 'transparent', color: active ? color : '#64748b', cursor: 'pointer' }}>
                    <Icon size={10} />{svc.replace('_', ' ')}
                  </button>
                )
              })}
            </div>
          </div>
        </Panel>
      </ReactFlow>
      {selectedNode && (
        <div style={{ position: 'absolute', top: 16, right: 16, width: 260, zIndex: 10, background: '#27272a', border: '1px solid #334155', borderRadius: 12, padding: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.6)', maxHeight: '80%', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: '#f1f5f9' }}>{selectedNode.data.label}</span>
            <button onClick={() => setSelectedNode(null)} style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Object.entries(selectedNode.data as Record<string, unknown>)
              .filter(([k, v]) => k !== 'id' && k !== 'label' && v != null && v !== '')
              .map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {k.replace(/([A-Z])/g, ' $1').trim()}
                  </div>
                  <div style={{ fontSize: 12, color: '#e2e8f0', fontFamily: 'monospace', wordBreak: 'break-all', marginTop: 1 }}>
                    {String(v)}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
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
  if (error) {
    const msg: string = (error as any)?.response?.data?.message ?? (error as any)?.message ?? ''
    const noPermission = msg.includes('not authorized') || msg.includes('xray:')
    return (
      <div className="flex flex-col items-center gap-2 text-sm py-12 text-center text-muted-foreground">
        <AlertTriangle size={20} className={noPermission ? 'text-amber-400' : 'text-destructive'} />
        {noPermission
          ? <><p className="font-medium">X-Ray permission missing</p><p className="text-xs max-w-sm">Add <code className="font-mono text-xs bg-muted px-1 rounded">xray:GetTraceSummaries</code> to your IAM role policy to use this feature.</p></>
          : <p>{msg || 'Failed to load traces'}</p>}
      </div>
    )
  }
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

// ── Explorer components ───────────────────────────────────────────────────────

interface TreeSelection {
  accountId: number
  region: string
  vpcId: string | null
}

function ResourceTree({
  accounts,
  selected,
  onSelect,
}: {
  accounts: AwsAccountResponse[]
  selected: TreeSelection | null
  onSelect: (sel: TreeSelection) => void
}) {
  const qcTree = useQueryClient()
  const [expandedAccounts, setExpandedAccounts] = useState<Set<number>>(new Set())
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(new Set())
  const [activeRegion, setActiveRegion] = useState<{ accountId: number; region: string } | null>(null)

  // Trigger fetch when a region is expanded; read per-(accountId,region) cache in render
  useQuery({
    queryKey: ['aws-explorer', activeRegion?.accountId, activeRegion?.region],
    queryFn: () => getExplorer(activeRegion!.accountId, activeRegion!.region),
    enabled: !!activeRegion,
    staleTime: 5 * 60 * 1000,
  })

  function toggleAccount(id: number) {
    setExpandedAccounts(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleRegion(accountId: number, region: string) {
    const key = `${accountId}:${region}`
    setExpandedRegions(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
        setActiveRegion({ accountId, region })
      }
      return next
    })
  }

  const isRegionExpanded = (accountId: number, region: string) =>
    expandedRegions.has(`${accountId}:${region}`)

  const isVpcSelected = (accountId: number, region: string, vpcId: string | null) =>
    selected?.accountId === accountId &&
    selected?.region === region &&
    selected?.vpcId === vpcId

  return (
    <div style={{
      width: 264, flexShrink: 0, borderRight: '1px solid #27272a',
      overflowY: 'auto', background: '#111113', padding: '12px 0',
    }}>
      <div style={{ padding: '0 12px 8px', fontSize: 10, fontWeight: 700, color: '#52525b', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        Accounts
      </div>
      {accounts.map(account => (
        <div key={account.id}>
          <button
            onClick={() => toggleAccount(account.id)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 12px', background: 'none', border: 'none', cursor: 'pointer',
              color: '#a1a1aa', fontSize: 12, fontWeight: 600, textAlign: 'left',
            }}
          >
            {expandedAccounts.has(account.id)
              ? <ChevronDown size={12} style={{ color: '#71717a', flexShrink: 0 }} />
              : <ChevronRight size={12} style={{ color: '#71717a', flexShrink: 0 }} />}
            <HardDrive size={12} style={{ color: '#60a5fa', flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {account.name}
            </span>
            {account.reachable
              ? <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#4ade80', marginLeft: 'auto', flexShrink: 0 }} />
              : <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#f87171', marginLeft: 'auto', flexShrink: 0 }} />}
          </button>

          {expandedAccounts.has(account.id) && REGIONS.map(region => (
            <div key={region}>
              <button
                onClick={() => toggleRegion(account.id, region)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 12px 4px 28px', background: 'none', border: 'none',
                  cursor: 'pointer', color: '#71717a', fontSize: 11, textAlign: 'left',
                }}
              >
                {isRegionExpanded(account.id, region)
                  ? <ChevronDown size={10} style={{ flexShrink: 0 }} />
                  : <ChevronRight size={10} style={{ flexShrink: 0 }} />}
                <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{region}</span>
              </button>

              {isRegionExpanded(account.id, region) && (
                <div>
                  {(() => {
                    const regionData = qcTree.getQueryData<AwsExplorerResponse>(['aws-explorer', account.id, region])
                    if (!regionData) return (
                      <div style={{ padding: '4px 12px 4px 44px', fontSize: 10, color: '#52525b' }}>
                        <Loader2 size={10} className="animate-spin" style={{ display: 'inline', marginRight: 4 }} />
                        Loading…
                      </div>
                    )
                    return (
                    <>
                      {regionData.vpcs.map(vpc => (
                        <button
                          key={vpc.vpcId}
                          onClick={() => onSelect({ accountId: account.id, region, vpcId: vpc.vpcId })}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center', gap: 6,
                            padding: '5px 12px 5px 44px',
                            background: isVpcSelected(account.id, region, vpc.vpcId) ? '#1e3a5f' : 'none',
                            border: 'none', cursor: 'pointer',
                            color: isVpcSelected(account.id, region, vpc.vpcId) ? '#93c5fd' : '#a1a1aa',
                            fontSize: 11, textAlign: 'left',
                          }}
                        >
                          <Network size={10} style={{ flexShrink: 0 }} />
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {vpc.name}
                          </span>
                          {vpc.ec2Count > 0 && (
                            <span style={{ fontSize: 9, color: '#4ade80', background: '#4ade8015', padding: '1px 5px', borderRadius: 10, flexShrink: 0 }}>
                              {vpc.ec2Count}
                            </span>
                          )}
                        </button>
                      ))}
                      <button
                        onClick={() => onSelect({ accountId: account.id, region, vpcId: null })}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', gap: 6,
                          padding: '5px 12px 5px 44px',
                          background: isVpcSelected(account.id, region, null) ? '#2a1f3d' : 'none',
                          border: 'none', cursor: 'pointer',
                          color: isVpcSelected(account.id, region, null) ? '#c4b5fd' : '#71717a',
                          fontSize: 11, textAlign: 'left',
                        }}
                      >
                        <Zap size={10} style={{ flexShrink: 0 }} />
                        <span style={{ flex: 1 }}>Global Resources</span>
                        <span style={{ fontSize: 9, color: '#71717a', flexShrink: 0 }}>
                          {regionData.lambdaCount}λ · {regionData.s3Count}S3
                        </span>
                      </button>
                    </>
                    )
                  })()}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function VpcDetail({
  accountId,
  region,
  vpc,
  onViewTopology,
}: {
  accountId: number
  region: string
  vpc: VpcSummary
  onViewTopology: () => void
}) {
  const qc = useQueryClient()
  const [confirmTerminate, setConfirmTerminate] = useState<string | null>(null)

  const { data: allInstances, isLoading: ec2Loading } = useQuery({
    queryKey: ['ec2-instances', accountId, region],
    queryFn: () => listEc2Instances(accountId, region),
    staleTime: 2 * 60 * 1000,
  })

  const { data: clusters, isLoading: ecsLoading } = useQuery({
    queryKey: ['ecs-clusters', accountId, region],
    queryFn: () => listEcsClusters(accountId, region),
    staleTime: 2 * 60 * 1000,
  })

  const instances = allInstances?.filter((i: any) => i.vpcId === vpc.vpcId) ?? []

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

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}>{vpc.name}</div>
          <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace', marginTop: 2 }}>
            {vpc.vpcId} · {vpc.cidr} · {region}
          </div>
        </div>
        <button
          onClick={onViewTopology}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
            background: '#1e3a5f', color: '#93c5fd', border: '1px solid #1d4ed8',
            cursor: 'pointer',
          }}
        >
          <Network size={13} />View Topology
        </button>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
          EC2 Instances ({instances.length})
        </div>
        {ec2Loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#64748b', fontSize: 13, padding: '12px 0' }}>
            <Loader2 size={14} className="animate-spin" />Loading instances…
          </div>
        )}
        {!ec2Loading && instances.length === 0 && (
          <div style={{ fontSize: 13, color: '#52525b', padding: '12px 0' }}>No EC2 instances in this VPC</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {instances.map((inst: any) => (
            <div key={inst.instanceId} className="bg-card border border-border rounded-xl p-4">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: '#18181b', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Server size={14} style={{ color: '#64748b' }} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {inst.name ?? inst.instanceId}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace', marginTop: 2 }}>
                      {inst.instanceId} · {inst.instanceType}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${stateColor(inst.state)}`}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
                    {inst.state}
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <button onClick={() => terminateMut.mutate(inst.instanceId)} disabled={terminateMut.isPending}
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20 transition-all">
                          Confirm
                        </button>
                        <button onClick={() => setConfirmTerminate(null)} className="text-[11px] text-muted-foreground px-2">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmTerminate(inst.instanceId)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                        <Trash2 size={12} />
                      </button>
                    )
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
          ECS Clusters ({clusters?.length ?? 0})
        </div>
        {ecsLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#64748b', fontSize: 13, padding: '12px 0' }}>
            <Loader2 size={14} className="animate-spin" />Loading clusters…
          </div>
        )}
        {!ecsLoading && clusters?.map((c: any) => (
          <EcsClusterRow key={c.clusterArn} accountId={accountId} cluster={c} />
        ))}
      </div>
    </div>
  )
}

function GlobalDetail({ accountId, region }: { accountId: number; region: string }) {
  const { data: buckets, isLoading: s3Loading } = useQuery({
    queryKey: ['s3-buckets', accountId],
    queryFn: () => listS3Buckets(accountId),
    staleTime: 15 * 60 * 1000,
  })

  const { data: clusters, isLoading: ecsLoading } = useQuery({
    queryKey: ['ecs-clusters', accountId, region],
    queryFn: () => listEcsClusters(accountId, region),
    staleTime: 2 * 60 * 1000,
  })

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>Global Resources</div>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 20 }}>{region} · Lambda · S3 · ECS</div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
          ECS Clusters
        </div>
        {ecsLoading
          ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#64748b', fontSize: 13 }}><Loader2 size={14} className="animate-spin" />Loading…</div>
          : !clusters?.length
            ? <div style={{ fontSize: 13, color: '#52525b' }}>No ECS clusters</div>
            : clusters.map((c: any) => <EcsClusterRow key={c.clusterArn} accountId={accountId} cluster={c} />)
        }
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
          S3 Buckets ({buckets?.length ?? 0})
        </div>
        {s3Loading
          ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#64748b', fontSize: 13 }}><Loader2 size={14} className="animate-spin" />Loading…</div>
          : !buckets?.length
            ? <div style={{ fontSize: 13, color: '#52525b' }}>No S3 buckets</div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {buckets.map((b: any) => (
                  <div key={b.name} className="bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-3">
                    <div style={{ width: 28, height: 28, borderRadius: 6, background: '#18181b', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <HardDrive size={12} style={{ color: '#64748b' }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: '#f1f5f9', fontFamily: 'monospace' }}>{b.name}</div>
                      {b.creationDate && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Created {new Date(b.creationDate).toLocaleDateString()}</div>}
                    </div>
                  </div>
                ))}
              </div>
        }
      </div>
    </div>
  )
}

function VpcTopologyModal({ accountId, region, vpc, onClose }: {
  accountId: number
  region: string
  vpc: VpcSummary
  onClose: () => void
}) {
  const { data: topo, isLoading } = useQuery({
    queryKey: ['topology', accountId, region],
    queryFn: () => getTopology(accountId, region),
    staleTime: 5 * 60 * 1000,
  })

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([])
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [selectedNode, setSelectedNode] = useState<any>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!topo?.nodes) return
    const vpcNodeIds = new Set<string>()
    vpcNodeIds.add('vpc:' + vpc.vpcId)
    topo.edges.forEach((e: any) => {
      if (e.source === 'vpc:' + vpc.vpcId) vpcNodeIds.add(e.target)
    })
    topo.edges.forEach((e: any) => {
      if (vpcNodeIds.has(e.source)) vpcNodeIds.add(e.target)
    })
    const filteredNodes = topo.nodes.filter((n: any) => vpcNodeIds.has(n.id))
    const filteredEdges = topo.edges.filter((e: any) => vpcNodeIds.has(e.source) && vpcNodeIds.has(e.target))
    const { nodes, edges } = buildGroupedLayout(filteredNodes, filteredEdges, search)
    setRfNodes(nodes)
    setRfEdges(edges)
  }, [topo, search, vpc.vpcId])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', padding: 24,
    }}>
      <div style={{
        display: 'flex', flexDirection: 'column', width: '100%', maxWidth: 1100,
        height: '85vh', borderRadius: 16, overflow: 'hidden',
        background: '#0d1117', border: '1px solid #30363d',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 20px', borderBottom: '1px solid #21262d', background: '#161b22', flexShrink: 0,
        }}>
          <div>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#e6edf3' }}>{vpc.name} — Topology</span>
            <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace', marginLeft: 10 }}>{vpc.vpcId} · {vpc.cidr}</span>
          </div>
          <button onClick={onClose} style={{ color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {isLoading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, color: '#64748b', fontSize: 13 }}>
              <Loader2 size={16} className="animate-spin" />Building topology…
            </div>
          )}
          {!isLoading && (
            <ReactFlow
              nodes={rfNodes} edges={rfEdges}
              onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
              nodeTypes={awsNodeTypes}
              onNodeClick={(_, node) => setSelectedNode(node)}
              onPaneClick={() => setSelectedNode(null)}
              fitView fitViewOptions={{ padding: 0.3 }} minZoom={0.08}
              style={{ background: '#010409' }}
            >
              <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="#21262d" />
              <Controls style={{ background: '#161b22', border: '1px solid #30363d' }} />
              <MiniMap pannable zoomable style={{ background: '#161b22', border: '1px solid #30363d' }} />
              <Panel position="top-left">
                <div style={{ position: 'relative' }}>
                  <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#64748b', pointerEvents: 'none' }} />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
                    style={{ padding: '5px 8px 5px 26px', background: '#161b22', border: '1px solid #30363d', borderRadius: 6, fontSize: 12, color: '#e6edf3', outline: 'none', width: 180 }} />
                </div>
              </Panel>
            </ReactFlow>
          )}
          {selectedNode && (
            <div style={{ position: 'absolute', top: 16, right: 16, width: 240, zIndex: 10, background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: 14, boxShadow: '0 4px 24px rgba(0,0,0,0.5)', maxHeight: '70%', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontWeight: 600, fontSize: 12, color: '#e6edf3' }}>{selectedNode.data.label}</span>
                <button onClick={() => setSelectedNode(null)} style={{ color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
              </div>
              {Object.entries(selectedNode.data as Record<string, unknown>)
                .filter(([k, v]) => k !== 'id' && k !== 'label' && v != null && v !== '')
                .map(([k, v]) => (
                  <div key={k} style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 9, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</div>
                    <div style={{ fontSize: 11, color: '#e2e8f0', fontFamily: 'monospace', wordBreak: 'break-all' }}>{String(v)}</div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AWS() {
  const qc = useQueryClient()
  const [showRegister, setShowRegister] = useState(false)
  const [editingAccount, setEditingAccount] = useState<AwsAccountResponse | null>(null)
  const [ssoLoginAccount, setSsoLoginAccount] = useState<AwsAccountResponse | null>(null)
  const [treeSelection, setTreeSelection] = useState<TreeSelection | null>(() => {
    try { const s = localStorage.getItem('aws:selection'); return s ? JSON.parse(s) : null } catch { return null }
  })

  function selectTree(sel: TreeSelection | null) {
    setTreeSelection(sel)
    if (sel) localStorage.setItem('aws:selection', JSON.stringify(sel))
    else localStorage.removeItem('aws:selection')
  }
  const [topologyVpc, setTopologyVpc] = useState<VpcSummary | null>(null)

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['aws-accounts'],
    queryFn: listAwsAccounts,
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteAwsAccount(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['aws-accounts'] }); selectTree(null) },
  })

  const evictMut = useMutation({
    mutationFn: (id: number) => evictAwsCache(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['aws-explorer'] })
      qc.invalidateQueries({ queryKey: ['ec2-instances'] })
      qc.invalidateQueries({ queryKey: ['ecs-clusters'] })
      qc.invalidateQueries({ queryKey: ['s3-buckets'] })
      qc.invalidateQueries({ queryKey: ['topology'] })
    },
  })

  const { data: explorerData } = useQuery({
    queryKey: ['aws-explorer', treeSelection?.accountId, treeSelection?.region],
    queryFn: () => getExplorer(treeSelection!.accountId, treeSelection!.region),
    enabled: !!treeSelection,
    staleTime: 5 * 60 * 1000,
  })

  const resolvedVpc = treeSelection?.vpcId != null
    ? explorerData?.vpcs.find(v => v.vpcId === treeSelection.vpcId) ?? null
    : null

  if (isLoading) return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground p-12 justify-center">
      <Loader2 size={16} className="animate-spin" />Loading…
    </div>
  )

  const selectedAccount = treeSelection ? accounts?.find(a => a.id === treeSelection.accountId) ?? null : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {showRegister && <RegisterModal onClose={() => setShowRegister(false)} />}
      {editingAccount && <RegisterModal editing={editingAccount} onClose={() => setEditingAccount(null)} />}
      {ssoLoginAccount && <SsoLoginModal account={ssoLoginAccount} onClose={() => setSsoLoginAccount(null)} />}
      {topologyVpc && treeSelection && (
        <VpcTopologyModal
          accountId={treeSelection.accountId}
          region={treeSelection.region}
          vpc={topologyVpc}
          onClose={() => setTopologyVpc(null)}
        />
      )}

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid #27272a', flexShrink: 0 }}>
        <h1 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>AWS Infrastructure</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {treeSelection && (
            <button
              onClick={() => evictMut.mutate(treeSelection.accountId)}
              disabled={evictMut.isPending}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 7, fontSize: 11, fontWeight: 600, background: 'transparent', border: '1px solid #334155', color: '#64748b', cursor: 'pointer' }}
              title="Refresh cached AWS data"
            >
              <RefreshCw size={11} style={{ animation: evictMut.isPending ? 'spin 1s linear infinite' : 'none' }} />
              Refresh Cache
            </button>
          )}
          <button
            onClick={() => setShowRegister(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:opacity-90 transition-all"
          >
            <Plus size={12} />Add Account
          </button>
        </div>
      </div>

      {/* No accounts empty state */}
      {!accounts?.length && (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center p-12">
          <HardDrive size={32} className="text-muted-foreground opacity-30" />
          <div>
            <p className="text-sm font-semibold text-foreground">No AWS accounts</p>
            <p className="text-xs text-muted-foreground mt-1">Register an AWS SSO profile to start exploring.</p>
          </div>
          <button onClick={() => setShowRegister(true)} className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 transition-all mt-1">
            <Plus size={13} />Register Account
          </button>
        </div>
      )}

      {/* Two-panel explorer */}
      {!!accounts?.length && (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <ResourceTree
            accounts={accounts}
            selected={treeSelection}
            onSelect={selectTree}
          />

          {/* Right panel */}
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            {!treeSelection && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 12, color: '#52525b' }}>
                <Network size={36} style={{ opacity: 0.25 }} />
                <div style={{ fontSize: 13, textAlign: 'center' }}>
                  Select an account in the tree,<br />expand a region, then choose a VPC.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16, width: '100%', maxWidth: 480 }}>
                  {accounts.map(a => (
                    <AccountCard
                      key={a.id}
                      account={a}
                      selected={false}
                      onSelect={() => {}}
                      onEdit={() => setEditingAccount(a)}
                      onSsoLogin={() => setSsoLoginAccount(a)}
                      onDelete={() => deleteMut.mutate(a.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {treeSelection && treeSelection.vpcId !== null && selectedAccount && resolvedVpc && (
              <VpcDetail
                accountId={treeSelection.accountId}
                region={treeSelection.region}
                vpc={resolvedVpc}
                onViewTopology={() => setTopologyVpc(resolvedVpc)}
              />
            )}

            {treeSelection && treeSelection.vpcId === null && (
              <GlobalDetail
                accountId={treeSelection.accountId}
                region={treeSelection.region}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
