import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, Link } from 'react-router-dom'
import { getMachines } from '../api/machines'
import { getDeployments, redeployDeployment } from '../api/deployments'
import { getAuditLog } from '../api/audit'
import { getGitHubUser } from '../api/github'
import { getQueueMetrics } from '../api/queueMetrics'
import { Server, Rocket, CheckCircle, Plus, Activity, AlertTriangle, RotateCcw, FileText, Radio, ListOrdered } from 'lucide-react'
import { OsIcon, StackIcon, StatusDot } from '../components/icons'
import Sparkline from '../components/Sparkline'
import OnboardingGuide from '../components/OnboardingGuide'
import { CompactMachineTelemetry } from '../components/MachineTelemetry'
import type { Deployment } from '../types'

function timeAgo(iso: string) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/** Last 7 calendar days (oldest first) as YYYY-MM-DD buckets, for the KPI sparklines. */
function last7Days(): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    return d.toISOString().slice(0, 10)
  })
}

function StatCard({ icon: Icon, label, value, sub, color, trend }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color: string; trend?: number[]
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 animate-fade-up card-hover">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>
          <Icon size={16} />
        </div>
        {trend && <Sparkline values={trend} />}
      </div>
      <p className="text-2xl font-bold text-foreground mb-0.5">{value}</p>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

function StatCardSkeleton() {
  return <div className="bg-card border border-border rounded-xl p-5 h-[108px] animate-pulse" />
}

function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="p-3 space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-14 bg-muted/30 rounded-lg animate-pulse" />
      ))}
    </div>
  )
}

function statusCls(status: string) {
  if (['ONLINE','RUNNING','SUCCESS','active'].includes(status)) return 'status-online'
  if (['ERROR','FAILED'].includes(status)) return 'status-error'
  if (['BUILDING','DEPLOYING','PENDING','PULLING'].includes(status)) return 'status-building'
  return 'status-muted'
}

const QUEUE_LABELS: Record<string, string> = {
  'deployment.run.queue': 'Deploy jobs',
  'deployment.queue': 'Deploy events',
  'hooks.queue': 'Post-deploy hooks',
}

export default function Dashboard() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: machines, isLoading: machinesLoading } = useQuery({ queryKey: ['machines'], queryFn: getMachines })
  const { data: deployments, isLoading: deploymentsLoading } = useQuery({
    queryKey: ['deployments', 0, 100], queryFn: () => getDeployments(0, 100),
  })
  const { data: auditLog, isLoading: auditLoading } = useQuery({ queryKey: ['audit', 0], queryFn: () => getAuditLog(0, 8) })
  const { data: githubUser, isLoading: githubLoading } = useQuery({ queryKey: ['github-user'], queryFn: getGitHubUser })
  const { data: queues } = useQuery({ queryKey: ['queue-metrics'], queryFn: getQueueMetrics, refetchInterval: 15_000 })

  const redeployMut = useMutation({
    mutationFn: redeployDeployment,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deployments'] }),
  })

  const onlineMachines    = machines?.filter(m => m.status === 'ONLINE').length ?? 0
  const activeTunnels     = deployments?.content.filter(d => d.tunnelHostname).length ?? 0
  const failedDeploys     = deployments?.content.filter(d => d.status === 'FAILED').slice(0, 5) ?? []

  const days = last7Days()
  const deploysPerDay = days.map(day =>
    deployments?.content.filter(d => d.createdAt.slice(0, 10) === day).length ?? 0)
  const successRatePerDay = days.map(day => {
    const dayDeploys = deployments?.content.filter(d => d.createdAt.slice(0, 10) === day) ?? []
    if (dayDeploys.length === 0) return 0
    return Math.round((dayDeploys.filter(d => d.status === 'SUCCESS').length / dayDeploys.length) * 100)
  })
  const weekTotal = deploysPerDay.reduce((a, b) => a + b, 0)
  const weekSuccess = deployments?.content.filter(d =>
    days.includes(d.createdAt.slice(0, 10)) && d.status === 'SUCCESS').length ?? 0
  const weekSuccessRate = weekTotal > 0 ? Math.round((weekSuccess / weekTotal) * 100) : 0

  const finishedThisWeek = (deployments?.content ?? []).filter(d =>
    days.includes(d.createdAt.slice(0, 10)) && d.startedAt && d.finishedAt)
  const avgDurationSeconds = finishedThisWeek.length > 0
    ? Math.round(finishedThisWeek.reduce((sum, d) =>
        sum + (new Date(d.finishedAt!).getTime() - new Date(d.startedAt!).getTime()) / 1000, 0) / finishedThisWeek.length)
    : null
  const avgDurationLabel = avgDurationSeconds == null ? undefined
    : avgDurationSeconds < 60 ? `avg ${avgDurationSeconds}s`
    : `avg ${Math.floor(avgDurationSeconds / 60)}m ${avgDurationSeconds % 60}s`

  const viewLogs = (d: Deployment) => navigate('/deployments', { state: { openId: d.id, openName: d.name } })

  const onboardingLoading = machinesLoading || githubLoading || deploymentsLoading
  const hasMachine = (machines?.length ?? 0) > 0
  const hasGithub = !!githubUser
  const hasDeployment = (deployments?.content.length ?? 0) > 0
  const showOnboarding = !onboardingLoading && !(hasMachine && hasGithub && hasDeployment)

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {showOnboarding && (
        <OnboardingGuide hasMachine={hasMachine} hasGithub={hasGithub} hasDeployment={hasDeployment} />
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6 stagger">
        {deploymentsLoading ? <StatCardSkeleton /> : (
          <StatCard icon={Rocket} label="Deploys this week" value={weekTotal} color="bg-chart-2/20 text-chart-2"
            trend={weekTotal > 0 ? deploysPerDay : undefined} sub={avgDurationLabel} />
        )}
        {deploymentsLoading ? <StatCardSkeleton /> : (
          <StatCard icon={CheckCircle} label="Success rate" value={`${weekSuccessRate}%`} color="bg-chart-5/20 text-chart-5"
            trend={weekTotal > 0 ? successRatePerDay : undefined} />
        )}
        {deploymentsLoading ? <StatCardSkeleton /> : (
          <StatCard icon={Radio} label="Active Tunnels" value={activeTunnels} color="bg-primary/15 text-primary" />
        )}
        {machinesLoading ? <StatCardSkeleton /> : (
          <StatCard icon={Server} label="Machines Online" value={`${onlineMachines}/${machines?.length ?? 0}`} color="bg-accent/15 text-accent" />
        )}
      </div>

      {/* Queue depth */}
      {!!queues?.length && (
        <div className="bg-card border border-border rounded-xl overflow-hidden animate-fade-up mb-6">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
            <ListOrdered size={14} className="text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Queue Depth</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
            {queues.map(q => (
              <div key={q.queueName} className="px-5 py-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{QUEUE_LABELS[q.queueName] ?? q.queueName}</span>
                <span className="text-xs font-mono text-foreground">
                  <span title="pending">{q.ready}</span> pending
                  {q.unacknowledged > 0 && <> · <span title="running">{q.unacknowledged}</span> running</>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Two-column overview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Machines */}
        <div className="bg-card border border-border rounded-xl overflow-hidden animate-fade-up" style={{ animationDelay: '100ms' }}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">Machines</h3>
            <Link to="/machines" className="text-xs text-primary hover:underline">View all →</Link>
          </div>
          {machinesLoading ? <ListSkeleton /> : !machines?.length ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
              <Server size={28} className="opacity-25" />
              <p className="text-sm">No machines yet</p>
              <Link to="/machines" className="text-xs text-primary hover:underline flex items-center gap-1"><Plus size={12}/>Register one</Link>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {machines.slice(0, 6).map(m => (
                <div key={m.id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/20 transition-colors">
                  <OsIcon name={m.name} size={32} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate" style={{ fontFamily: "'Fira Code', monospace" }}>{m.host}</p>
                    <p className="text-xs text-muted-foreground truncate">{m.name} · port {m.port}</p>
                  </div>
                  {m.status === 'ONLINE' && <CompactMachineTelemetry machineId={m.id} />}
                  <div className="flex items-center gap-2">
                    <StatusDot status={m.status} />
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${statusCls(m.status)}`}>{m.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent deployments */}
        <div className="bg-card border border-border rounded-xl overflow-hidden animate-fade-up" style={{ animationDelay: '150ms' }}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">Recent Deployments</h3>
            <Link to="/deployments" className="text-xs text-primary hover:underline">View all →</Link>
          </div>
          {deploymentsLoading ? <ListSkeleton /> : !deployments?.content.length ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
              <Rocket size={28} className="opacity-25" />
              <p className="text-sm">No deployments yet</p>
              <Link to="/deployments" className="text-xs text-primary hover:underline flex items-center gap-1"><Plus size={12}/>Create one</Link>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {deployments.content.slice(0, 6).map(d => (
                <div key={d.id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/20 transition-colors">
                  <StackIcon stack={d.detectedStack} size={32} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{d.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {d.type}{d.branch ? ` · ${d.branch}` : ''}{d.machineName ? ` · ${d.machineName}` : ''}
                    </p>
                  </div>
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${statusCls(d.status)}`}>{d.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Failure feed */}
      {(deploymentsLoading || failedDeploys.length > 0) && (
        <div className="bg-card border border-border rounded-xl overflow-hidden animate-fade-up mt-4" style={{ animationDelay: '175ms' }}>
          <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
            <AlertTriangle size={14} className="text-destructive" />
            <h3 className="text-sm font-semibold text-foreground">Needs Attention</h3>
          </div>
          {deploymentsLoading ? <ListSkeleton rows={2} /> : (
            <div className="divide-y divide-border">
              {failedDeploys.map(d => (
                <div key={d.id} className="flex items-center gap-3 px-5 py-3">
                  <StackIcon stack={d.detectedStack} size={32} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{d.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {d.type}{d.machineName ? ` · ${d.machineName}` : ''} · {timeAgo(d.createdAt)}
                    </p>
                  </div>
                  <button onClick={() => viewLogs(d)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-muted transition-colors">
                    <FileText size={12} /> Logs
                  </button>
                  <button onClick={() => redeployMut.mutate(d.id)} disabled={redeployMut.isPending}
                    className="flex items-center gap-1 text-xs text-primary hover:opacity-80 px-2 py-1 rounded-md hover:bg-primary/10 transition-colors disabled:opacity-50">
                    <RotateCcw size={12} /> Redeploy
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Activity feed */}
      <div className="bg-card border border-border rounded-xl overflow-hidden animate-fade-up mt-4" style={{ animationDelay: '200ms' }}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
          <Activity size={14} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Recent Activity</h3>
        </div>
        {auditLoading ? <ListSkeleton rows={3} /> : !auditLog?.content.length ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
            <Activity size={24} className="opacity-25" />
            <p className="text-sm">No activity yet</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {auditLog.content.map(a => (
              <div key={a.id} className="flex items-center gap-3 px-5 py-2.5">
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${a.success ? 'status-online' : 'status-error'}`}>
                  {a.httpMethod}
                </span>
                <code className="text-xs font-mono text-foreground flex-1 truncate">{a.path}</code>
                <span className="text-xs text-muted-foreground shrink-0">{a.username}</span>
                <span className="text-[11px] text-muted-foreground shrink-0 w-14 text-right">{timeAgo(a.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
