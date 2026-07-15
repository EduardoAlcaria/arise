import { useQuery } from '@tanstack/react-query'
import { getMachines } from '../api/machines'
import { getContainers } from '../api/containers'
import { getDeployments } from '../api/deployments'
import { getAuditLog } from '../api/audit'
import { Server, Box, Rocket, CheckCircle, Plus, Activity } from 'lucide-react'
import { Link } from 'react-router-dom'
import { OsIcon, StackIcon, StatusDot } from '../components/icons'

function timeAgo(iso: string) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color: string
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 animate-fade-up card-hover">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>
          <Icon size={16} />
        </div>
      </div>
      <p className="text-2xl font-bold text-foreground mb-0.5">{value}</p>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

function statusCls(status: string) {
  if (['ONLINE','RUNNING','SUCCESS','active'].includes(status)) return 'status-online'
  if (['ERROR','FAILED'].includes(status)) return 'status-error'
  if (['BUILDING','DEPLOYING','PENDING','PULLING'].includes(status)) return 'status-building'
  return 'status-muted'
}

export default function Dashboard() {
  const { data: machines }    = useQuery({ queryKey: ['machines'], queryFn: getMachines })
  const { data: containers }  = useQuery({ queryKey: ['containers'], queryFn: getContainers })
  const { data: deployments } = useQuery({ queryKey: ['deployments', 0], queryFn: () => getDeployments(0) })
  const { data: auditLog } = useQuery({ queryKey: ['audit', 0], queryFn: () => getAuditLog(0, 8) })

  const onlineMachines    = machines?.filter(m => m.status === 'ONLINE').length ?? 0
  const runningContainers = containers?.filter(c => c.status === 'RUNNING').length ?? 0
  const successDeploys    = deployments?.content.filter(d => d.status === 'SUCCESS').length ?? 0
  const totalDeploys      = deployments?.totalElements ?? 0

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6 stagger">
        <StatCard icon={Server}       label="Machines Online"  value={`${onlineMachines}/${machines?.length ?? 0}`}   color="bg-accent/15 text-accent" />
        <StatCard icon={Box}          label="Containers Running" value={`${runningContainers}/${containers?.length ?? 0}`} color="bg-primary/15 text-primary" />
        <StatCard icon={Rocket}       label="Total Deployments" value={totalDeploys}                                   color="bg-chart-2/20 text-chart-2" />
        <StatCard icon={CheckCircle}  label="Successful Deploys" value={successDeploys}                               color="bg-chart-5/20 text-chart-5" />
      </div>

      {/* Two-column overview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Machines */}
        <div className="bg-card border border-border rounded-xl overflow-hidden animate-fade-up" style={{ animationDelay: '100ms' }}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">Machines</h3>
            <Link to="/machines" className="text-xs text-primary hover:underline">View all →</Link>
          </div>
          {!machines?.length ? (
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
          {!deployments?.content.length ? (
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

      {/* Activity feed */}
      <div className="bg-card border border-border rounded-xl overflow-hidden animate-fade-up mt-4" style={{ animationDelay: '200ms' }}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
          <Activity size={14} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Recent Activity</h3>
        </div>
        {!auditLog?.content.length ? (
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
