import { useQuery } from '@tanstack/react-query'
import { getMachineMetrics } from '../api/machines'
import Sparkline from './Sparkline'
import { Cpu, MemoryStick, HardDrive } from 'lucide-react'

function pct(used: number | null, total: number | null): number | null {
  if (used == null || total == null || total === 0) return null
  return Math.round((used / total) * 100)
}

function TelemetryRow({ icon: Icon, label, value, trend }: {
  icon: React.ElementType; label: string; value: string; trend: number[]
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <Icon size={12} className="text-muted-foreground shrink-0" />
      <span className="text-muted-foreground w-9 shrink-0">{label}</span>
      <span className="text-foreground font-medium w-11 shrink-0">{value}</span>
      {trend.length > 1 && <Sparkline values={trend} width={56} height={18} />}
    </div>
  )
}

/** Single-line "load · ram% · disk%" readout for a Dashboard machine row —
 * current values only, no sparklines (those live on the Machines page card). */
export function CompactMachineTelemetry({ machineId }: { machineId: number }) {
  const { data: metrics } = useQuery({
    queryKey: ['machine-metrics', machineId],
    queryFn: () => getMachineMetrics(machineId),
    refetchInterval: 60_000,
  })
  const latest = metrics?.[0]
  if (!latest) return null
  const memPct = pct(latest.memUsedMb, latest.memTotalMb)
  const diskPct = pct(latest.diskUsedMb, latest.diskTotalMb)

  return (
    <span className="text-[11px] text-muted-foreground font-mono shrink-0">
      {latest.cpuLoad?.toFixed(1) ?? '—'} · {memPct != null ? `${memPct}%` : '—'} · {diskPct != null ? `${diskPct}%` : '—'}
    </span>
  )
}

/** Full CPU/RAM/disk telemetry block for a Machines-page card. Renders nothing
 * until at least one sample exists (offline / never-pinged machines). */
export default function MachineTelemetry({ machineId }: { machineId: number }) {
  const { data: metrics } = useQuery({
    queryKey: ['machine-metrics', machineId],
    queryFn: () => getMachineMetrics(machineId),
    refetchInterval: 60_000,
  })

  if (!metrics?.length) return null

  // Backend returns newest-first; sparklines read left-to-right oldest-first.
  const chronological = [...metrics].reverse()
  const latest = metrics[0]
  const memPct = pct(latest.memUsedMb, latest.memTotalMb)
  const diskPct = pct(latest.diskUsedMb, latest.diskTotalMb)

  return (
    <div className="flex flex-col gap-1.5 py-3 border-t border-border">
      <TelemetryRow icon={Cpu} label="Load" value={latest.cpuLoad?.toFixed(2) ?? '—'}
        trend={chronological.map(m => m.cpuLoad ?? 0)} />
      <TelemetryRow icon={MemoryStick} label="RAM" value={memPct != null ? `${memPct}%` : '—'}
        trend={chronological.map(m => pct(m.memUsedMb, m.memTotalMb) ?? 0)} />
      <TelemetryRow icon={HardDrive} label="Disk" value={diskPct != null ? `${diskPct}%` : '—'}
        trend={chronological.map(m => pct(m.diskUsedMb, m.diskTotalMb) ?? 0)} />
    </div>
  )
}
