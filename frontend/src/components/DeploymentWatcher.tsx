import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDeployment, getDeploymentLogs } from '../api/deployments'
import { X, CheckCircle2, XCircle, Loader2, Clock } from 'lucide-react'

const TERMINAL = ['SUCCESS', 'FAILED', 'ROLLED_BACK']

interface Props {
  deploymentId: number
  deploymentName: string
  onClose: () => void
}

function statusIcon(status: string) {
  if (status === 'SUCCESS') return <CheckCircle2 size={16} className="text-green-400 shrink-0" />
  if (status === 'FAILED') return <XCircle size={16} className="text-red-400 shrink-0" />
  if (['BUILDING', 'DEPLOYING'].includes(status)) return <Loader2 size={16} className="text-primary animate-spin shrink-0" />
  return <Clock size={16} className="text-muted-foreground shrink-0" />
}

function logColor(level: string) {
  if (level === 'ERROR') return 'text-red-400'
  if (level === 'WARN') return 'text-yellow-400'
  if (level === 'DEBUG') return 'text-muted-foreground'
  return 'text-foreground/80'
}

export default function DeploymentWatcher({ deploymentId, deploymentName, onClose }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  const { data: deployment } = useQuery({
    queryKey: ['dep-watch-status', deploymentId],
    queryFn: () => getDeployment(deploymentId),
    refetchInterval: (q) => {
      const s = q.state.data?.status
      return s && TERMINAL.includes(s) ? false : 2000
    },
  })

  const done = !!deployment?.status && TERMINAL.includes(deployment.status)

  const { data: logs } = useQuery({
    queryKey: ['dep-watch-logs', deploymentId],
    queryFn: () => getDeploymentLogs(deploymentId),
    refetchInterval: done ? false : 1500,
  })

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs?.length])

  const status = deployment?.status ?? 'PENDING'
  const isSuccess = status === 'SUCCESS'
  const isFailed = status === 'FAILED'

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-3xl shadow-2xl animate-fade-up flex flex-col"
        style={{ maxHeight: '82vh' }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          {statusIcon(status)}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-foreground text-sm truncate">{deploymentName}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 uppercase tracking-wide">
              {done ? status : `${status}…`}
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors ml-2">
            <X size={16} />
          </button>
        </div>

        {/* Log area */}
        <div className="flex-1 overflow-y-auto min-h-0 p-4 font-mono text-xs leading-relaxed bg-[oklch(0.10_0_0)] rounded-b-2xl">
          {!logs?.length ? (
            <span className="text-muted-foreground">Waiting for output…</span>
          ) : (
            logs.map((l) => (
              <div key={l.id} className={`whitespace-pre-wrap break-all ${logColor(l.level)}`}>
                {l.message}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Footer — only when terminal */}
        {done && (
          <div className="px-5 py-3 border-t border-border shrink-0 flex items-center justify-between">
            <p className={`text-xs font-medium ${isSuccess ? 'text-green-400' : isFailed ? 'text-red-400' : 'text-muted-foreground'}`}>
              {isSuccess ? 'Deployment completed successfully.' : isFailed ? 'Deployment failed. Check logs above.' : 'Rolled back.'}
            </p>
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:opacity-90 transition-opacity"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
