import { useEffect, useRef, useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDeployment, streamDeploymentLogs } from '../api/deployments'
import {
  X, CheckCircle2, XCircle, Loader2, Circle,
  ArrowDown,
} from 'lucide-react'

const TERMINAL = ['SUCCESS', 'FAILED', 'ROLLED_BACK']

// ── Step parsing ──────────────────────────────────────────────────────────────

interface Step {
  id: number
  name: string
  lines: string[]
  status: 'pending' | 'running' | 'success' | 'failed'
}

const TRIGGERS: { re: RegExp; label: (m: RegExpMatchArray) => string }[] = [
  { re: /Cloning (repository|service)/i,             label: () => 'Clone repository' },
  { re: /Detected stack[:\s]+(.+)/i,                  label: m => `Detect stack · ${m[1].trim()}` },
  { re: /Running:\s+(.+)/i,                           label: m => m[1].trim() },
  { re: /Running (docker compose|docker-compose)/i,   label: () => 'docker compose up --build' },
  { re: /Starting(?: service)?[:\s]+(.+)/i,           label: m => `Start · ${m[1].trim()}` },
  { re: /Creating Cloudflare tunnel[:\s]+(.+)/i,      label: m => `Tunnel · ${m[1].trim()}` },
  { re: /Writing config[:\s]+(.+)/i,                  label: m => `Write config · ${m[1].trim()}` },
  { re: /BUILD SUCCESS/i,                             label: () => 'Build success' },
  { re: /All services started/i,                       label: () => 'All services started' },
  { re: /✓\s+Deployment successful/i,                 label: () => '✓ Deployment complete' },
  { re: /✗\s+Deployment failed/i,                     label: () => '✗ Deployment failed' },
  { re: /Starting application deployment[:\s]+(.+)/i, label: m => `Deploy application · ${m[1].trim()}` },
]

function parseSteps(lines: string[]): Step[] {
  const steps: Step[] = []
  let current: Step | null = null
  let nextId = 0

  const flush = () => {
    if (!current) return
    if (current.status === 'running') current.status = 'success'
    steps.push(current)
    current = null
  }

  for (const line of lines) {
    const clean = line.replace(/^\[(?:INFO|WARN|ERROR|DEBUG)\]\s*/, '')
    let triggered = false
    for (const { re, label } of TRIGGERS) {
      const m = clean.match(re)
      if (m) {
        flush()
        current = { id: nextId++, name: label(m), lines: [line], status: 'running' }
        triggered = true
        break
      }
    }
    if (!triggered) {
      if (!current && line.trim()) {
        current = { id: nextId++, name: 'Initialize', lines: [line], status: 'running' }
      } else if (current) {
        current.lines.push(line)
        if (line.includes('[ERROR]') || (line.includes('✗') && !line.includes('Deployment'))) {
          current.status = 'failed'
        }
      }
    }
  }

  if (current) {
    const last = current.lines.at(-1) ?? ''
    if (last.includes('✗') || last.toLowerCase().includes('failed')) current.status = 'failed'
    else if (current.status === 'running') current.status = 'success'
    steps.push(current)
  }

  return steps
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[mGKHF]/g, '')
}

function lineColor(msg: string): string {
  if (msg.includes('[ERROR]') || msg.includes('✗')) return '#f87171'
  if (msg.includes('[WARN]'))  return '#fbbf24'
  if (msg.includes('[DEBUG]')) return '#4b5563'
  if (msg.includes('✓'))      return '#4ade80'
  return '#8b949e'
}

function StepIcon({ status }: { status: Step['status'] }) {
  if (status === 'running') return <Loader2 size={14} className="animate-spin text-blue-400 shrink-0" />
  if (status === 'success') return <CheckCircle2 size={14} className="shrink-0" style={{ color: '#3fb950' }} />
  if (status === 'failed')  return <XCircle size={14} className="shrink-0" style={{ color: '#f85149' }} />
  return <Circle size={14} className="shrink-0" style={{ color: '#484f58' }} />
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  deploymentId: number
  deploymentName: string
  onClose: () => void
}

export default function DeploymentWatcher({ deploymentId, deploymentName, onClose }: Props) {
  const [logLines, setLogLines]     = useState<string[]>([])
  const [selectedIdx, setSelectedIdx] = useState<number>(0)
  const [autoScroll, setAutoScroll] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const stepStartRef = useRef<Map<number, number>>(new Map())
  const [now, setNow] = useState(Date.now())

  const { data: deployment } = useQuery({
    queryKey: ['dep-watch-status', deploymentId],
    queryFn: () => getDeployment(deploymentId),
    refetchInterval: q => {
      const s = q.state.data?.status
      return s && TERMINAL.includes(s) ? false : 2000
    },
  })

  useEffect(() => {
    setLogLines([])
    const stop = streamDeploymentLogs(
      deploymentId,
      line => setLogLines(prev => [...prev, line]),
      () => {},
      err => console.error('[DeploymentWatcher] SSE error', err),
    )
    return stop
  }, [deploymentId])

  const steps = useMemo(() => parseSteps(logLines), [logLines])

  const status    = deployment?.status ?? 'PENDING'
  const done      = TERMINAL.includes(status)
  const isSuccess = status === 'SUCCESS'
  const isFailed  = status === 'FAILED'

  // Elapsed time ticker
  useEffect(() => {
    if (done) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [done])

  // Track when each step starts
  useEffect(() => {
    steps.forEach((step, i) => {
      if (step.status === 'running' && !stepStartRef.current.has(i)) {
        stepStartRef.current.set(i, Date.now())
      }
    })
  }, [steps])

  // Auto-select the currently-running step
  useEffect(() => {
    const idx = steps.findIndex(s => s.status === 'running')
    if (idx >= 0) setSelectedIdx(idx)
  }, [steps.length])

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logLines.length, autoScroll])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
  }

  function stepDuration(idx: number, stepStatus: Step['status']): string {
    const start = stepStartRef.current.get(idx)
    if (!start) return ''
    const elapsed = Math.round(((stepStatus === 'running' ? now : Date.now()) - start) / 1000)
    const m = Math.floor(elapsed / 60)
    const s = elapsed % 60
    return m > 0 ? `${m}m ${s}s` : `${s}s`
  }

  const selectedStep = steps[selectedIdx] ?? null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
         style={{ background: 'rgba(1,4,9,0.88)' }}>
      <div
        className="flex flex-col w-full max-w-5xl rounded-xl overflow-hidden"
        style={{ height: '88vh', background: '#0d1117', border: '1px solid #30363d', boxShadow: '0 24px 64px rgba(0,0,0,0.8)' }}
      >
        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-5 py-3 shrink-0" style={{ borderBottom: '1px solid #21262d', background: '#161b22' }}>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {done
              ? (isSuccess
                  ? <CheckCircle2 size={16} style={{ color: '#3fb950', flexShrink: 0 }} />
                  : <XCircle size={16} style={{ color: '#f85149', flexShrink: 0 }} />)
              : <Loader2 size={16} className="animate-spin shrink-0" style={{ color: '#58a6ff' }} />}
            <span className="font-semibold text-sm truncate" style={{ color: '#e6edf3' }}>{deploymentName}</span>
            <span className="text-[11px] font-mono shrink-0" style={{ color: '#484f58' }}>#{deploymentId}</span>
          </div>
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 uppercase tracking-wider"
            style={{
              background: isSuccess ? '#1a3828' : isFailed ? '#3d1a1a' : '#1a2638',
              color: isSuccess ? '#3fb950' : isFailed ? '#f85149' : '#58a6ff',
              border: `1px solid ${isSuccess ? '#3fb95030' : isFailed ? '#f8514930' : '#58a6ff30'}`,
            }}
          >
            {status}
          </span>
          <button onClick={onClose} style={{ color: '#484f58' }} className="hover:text-white transition-colors ml-1 shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* ── Body: step list + log panel ── */}
        <div className="flex flex-1 min-h-0">
          {/* ── Left: step list ── */}
          <div
            className="flex flex-col shrink-0 overflow-y-auto"
            style={{ width: 260, borderRight: '1px solid #21262d', background: '#0d1117' }}
          >
            {steps.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-6 text-xs" style={{ color: '#484f58' }}>
                <Loader2 size={12} className="animate-spin" /> Waiting…
              </div>
            ) : (
              steps.map((step, i) => {
                const active = selectedIdx === i
                return (
                  <button
                    key={step.id}
                    onClick={() => setSelectedIdx(i)}
                    className="flex items-center gap-2.5 px-4 py-2.5 text-left w-full transition-colors shrink-0"
                    style={{
                      background: active ? '#161b22' : 'transparent',
                      borderLeft: active ? '2px solid #58a6ff' : '2px solid transparent',
                      borderBottom: '1px solid #21262d',
                    }}
                    onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#111317' }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
                  >
                    <StepIcon status={step.status} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] truncate" style={{ color: active ? '#e6edf3' : '#8b949e' }}>
                        {step.name}
                      </div>
                      {stepDuration(i, step.status) && (
                        <div className="text-[10px] mt-0.5" style={{ color: '#484f58' }}>
                          {stepDuration(i, step.status)}
                        </div>
                      )}
                    </div>
                  </button>
                )
              })
            )}
          </div>

          {/* ── Right: log output ── */}
          <div
            className="flex-1 flex flex-col min-w-0 min-h-0"
            style={{ background: '#010409' }}
          >
            {selectedStep ? (
              <>
                {/* Log area */}
                <div
                  ref={scrollRef}
                  onScroll={onScroll}
                  className="flex-1 overflow-y-auto font-mono text-[12px] leading-relaxed px-4 py-3"
                >
                  {selectedStep.lines.map((line, j) => (
                    <div key={j} className="flex gap-3 hover:bg-white/5 px-1 -mx-1 rounded">
                      <span className="select-none text-right shrink-0 w-8" style={{ color: '#3d444d', fontSize: 11 }}>
                        {j + 1}
                      </span>
                      <span style={{ color: lineColor(line), whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {stripAnsi(line)}
                      </span>
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </div>

                {/* Log footer */}
                <div
                  className="flex items-center justify-between px-4 py-2 shrink-0"
                  style={{ borderTop: '1px solid #21262d' }}
                >
                  <span className="text-[11px]" style={{ color: '#484f58' }}>
                    {selectedStep.lines.length} line{selectedStep.lines.length !== 1 ? 's' : ''}
                    {!done && selectedStep.status === 'running' && ' · live'}
                  </span>
                  <div className="flex items-center gap-3">
                    {!autoScroll && (
                      <button
                        onClick={() => { setAutoScroll(true); bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }}
                        className="flex items-center gap-1.5 text-[12px] transition-colors"
                        style={{ color: '#58a6ff' }}
                      >
                        <ArrowDown size={12} /> Bottom
                      </button>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-xs" style={{ color: '#484f58' }}>
                Select a step to view logs
              </div>
            )}
          </div>
        </div>

        {/* ── Footer ── */}
        <div
          className="flex items-center justify-between px-5 py-2.5 shrink-0"
          style={{ borderTop: '1px solid #21262d', background: '#161b22' }}
        >
          <span className="text-[11px]" style={{ color: '#484f58' }}>
            {steps.length} step{steps.length !== 1 ? 's' : ''}{!done && ' · streaming live'}
          </span>
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors"
            style={{ background: done ? '#238636' : '#30363d', color: '#fff' }}
            onMouseEnter={e => (e.currentTarget.style.background = done ? '#2ea043' : '#444c56')}
            onMouseLeave={e => (e.currentTarget.style.background = done ? '#238636' : '#30363d')}
          >
            {done ? 'Close' : 'Hide'}
          </button>
        </div>
      </div>
    </div>
  )
}
