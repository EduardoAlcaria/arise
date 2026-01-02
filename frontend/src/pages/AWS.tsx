import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listEc2Instances, listS3Buckets, listEcsClusters, listEcsServices,
  startInstance, stopInstance, terminateInstance,
  getAwsStatus, Ec2Instance, EcsCluster,
} from '../api/aws'
import {
  Server, HardDrive, Box, Play, Square, Trash2, ChevronDown, ChevronRight,
  AlertTriangle, Loader2, RefreshCw,
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

function Ec2Tab({ region }: { region: string }) {
  const qc = useQueryClient()
  const [confirmTerminate, setConfirmTerminate] = useState<string | null>(null)

  const { data: instances, isLoading, error, refetch } = useQuery({
    queryKey: ['ec2-instances', region],
    queryFn: () => listEc2Instances(region),
  })

  const startMut = useMutation({
    mutationFn: (id: string) => startInstance(id, region),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ec2-instances', region] }),
  })
  const stopMut = useMutation({
    mutationFn: (id: string) => stopInstance(id, region),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ec2-instances', region] }),
  })
  const terminateMut = useMutation({
    mutationFn: (id: string) => terminateInstance(id, region),
    onSuccess: () => {
      setConfirmTerminate(null)
      qc.invalidateQueries({ queryKey: ['ec2-instances', region] })
    },
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
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                <Server size={14} className="text-muted-foreground" />
              </div>
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
                <button
                  onClick={() => startMut.mutate(inst.instanceId)}
                  disabled={startMut.isPending}
                  className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20 disabled:opacity-50 transition-all"
                >
                  {startMut.isPending ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}Start
                </button>
              )}
              {inst.state === 'running' && (
                <button
                  onClick={() => stopMut.mutate(inst.instanceId)}
                  disabled={stopMut.isPending}
                  className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-muted text-muted-foreground border border-border hover:bg-muted/70 disabled:opacity-50 transition-all"
                >
                  {stopMut.isPending ? <Loader2 size={10} className="animate-spin" /> : <Square size={10} />}Stop
                </button>
              )}
              {inst.state !== 'terminated' && (
                confirmTerminate === inst.instanceId ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => terminateMut.mutate(inst.instanceId)}
                      disabled={terminateMut.isPending}
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20 disabled:opacity-50 transition-all"
                    >
                      {terminateMut.isPending ? <Loader2 size={10} className="animate-spin" /> : 'Confirm'}
                    </button>
                    <button
                      onClick={() => setConfirmTerminate(null)}
                      className="text-[11px] text-muted-foreground hover:text-foreground px-2"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmTerminate(inst.instanceId)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title="Terminate instance"
                  >
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

function S3Tab() {
  const { data: buckets, isLoading, error } = useQuery({
    queryKey: ['s3-buckets'],
    queryFn: listS3Buckets,
  })

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center"><Loader2 size={16} className="animate-spin" />Loading buckets…</div>
  if (error) return <div className="flex items-center gap-2 text-sm text-destructive py-12 justify-center"><AlertTriangle size={15} />{(error as any)?.response?.data?.message ?? 'Failed to load'}</div>
  if (!buckets?.length) return <div className="text-sm text-muted-foreground py-12 text-center">No S3 buckets found</div>

  return (
    <div className="flex flex-col gap-2">
      {buckets.map(b => (
        <div key={b.name} className="bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <Box size={13} className="text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground font-mono truncate">{b.name}</p>
            {b.creationDate && <p className="text-[11px] text-muted-foreground mt-0.5">Created {new Date(b.creationDate).toLocaleDateString()}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}

function EcsClusterRow({ cluster }: { cluster: EcsCluster }) {
  const [open, setOpen] = useState(false)
  const { data: services, isLoading } = useQuery({
    queryKey: ['ecs-services', cluster.clusterArn],
    queryFn: () => listEcsServices(cluster.clusterArn, cluster.region),
    enabled: open,
  })

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors"
      >
        <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <Server size={13} className="text-muted-foreground" />
        </div>
        <div className="flex-1 text-left min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{cluster.clusterName}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{cluster.activeServicesCount} services · {cluster.runningTasksCount} running tasks</p>
        </div>
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border mr-2 ${cluster.status === 'ACTIVE' ? 'status-online' : 'status-muted'}`}>
          {cluster.status}
        </span>
        {open ? <ChevronDown size={14} className="text-muted-foreground shrink-0" /> : <ChevronRight size={14} className="text-muted-foreground shrink-0" />}
      </button>
      {open && (
        <div className="border-t border-border px-4 py-3 flex flex-col gap-2">
          {isLoading && <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" />Loading services…</div>}
          {!isLoading && (!services?.length) && <p className="text-xs text-muted-foreground">No services</p>}
          {services?.map(svc => (
            <div key={svc.serviceArn} className="flex items-center gap-3 px-3 py-2 bg-muted/30 rounded-lg">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{svc.serviceName}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 font-mono truncate">{svc.taskDefinition.split('/').pop()}</p>
              </div>
              <div className="text-[11px] text-muted-foreground shrink-0">{svc.runningCount}/{svc.desiredCount} tasks</div>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${svc.status === 'ACTIVE' ? 'status-online' : 'status-muted'}`}>
                {svc.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function EcsTab({ region }: { region: string }) {
  const { data: clusters, isLoading, error } = useQuery({
    queryKey: ['ecs-clusters', region],
    queryFn: () => listEcsClusters(region),
  })

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center"><Loader2 size={16} className="animate-spin" />Loading clusters…</div>
  if (error) return <div className="flex items-center gap-2 text-sm text-destructive py-12 justify-center"><AlertTriangle size={15} />{(error as any)?.response?.data?.message ?? 'Failed to load'}</div>
  if (!clusters?.length) return <div className="text-sm text-muted-foreground py-12 text-center">No ECS clusters in {region}</div>

  return (
    <div className="flex flex-col gap-3">
      {clusters.map(c => <EcsClusterRow key={c.clusterArn} cluster={c} />)}
    </div>
  )
}

type Tab = 'ec2' | 's3' | 'ecs'

export default function AWS() {
  const [tab, setTab] = useState<Tab>('ec2')
  const [region, setRegion] = useState('us-east-1')

  const { data: status } = useQuery({
    queryKey: ['aws-status'],
    queryFn: getAwsStatus,
    retry: false,
    staleTime: 60_000,
  })

  if (!status?.configured) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
            <HardDrive size={26} className="text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">AWS not configured</p>
            <p className="text-xs text-muted-foreground mt-1">Add your AWS credentials in <a href="/settings" className="text-primary underline underline-offset-2">Settings</a> to manage EC2, S3, and ECS.</p>
          </div>
        </div>
      </div>
    )
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'ec2', label: 'EC2 Instances' },
    { id: 's3', label: 'S3 Buckets' },
    { id: 'ecs', label: 'ECS' },
  ]

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">AWS</h1>
          {status.accountId && (
            <p className="text-xs text-muted-foreground mt-0.5 font-mono">Account {status.accountId}</p>
          )}
        </div>
        {tab !== 's3' && (
          <select
            value={region}
            onChange={e => setRegion(e.target.value)}
            className="input-field text-xs py-1.5 w-auto"
          >
            {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-muted/50 rounded-lg p-1 w-fit border border-border">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
              tab === t.id
                ? 'bg-card text-foreground shadow-sm border border-border'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'ec2' && <Ec2Tab region={region} />}
      {tab === 's3' && <S3Tab />}
      {tab === 'ecs' && <EcsTab region={region} />}
    </div>
  )
}
