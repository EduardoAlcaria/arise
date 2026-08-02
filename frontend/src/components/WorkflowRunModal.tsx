import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getWorkflowJobs, getJobLogs, getRunStepLogs } from '../api/cicd'
import { errorMessage } from './ErrorBanner'
import { X, CheckCircle2, XCircle, Loader2, Circle, Clock, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'

interface Props {
  owner: string
  repo: string
  runId: number
  runName: string
  initialStatus: string
  initialConclusion: string | null
  onClose: () => void
}

function stripTimestamp(line: string): string {
  return line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, '')
}

function stripAnsi(line: string): string {
  // eslint-disable-next-line no-control-regex
  return line.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
}

function cleanLine(line: string): string {
  return stripAnsi(stripTimestamp(line))
    .replace(/##\[(group|endgroup|error|warning|notice|debug|command|section)\]/g, '')
}

function lineColor(raw: string): string {
  if (raw.includes('##[error]')) return '#f87171'
  if (raw.includes('##[warning]')) return '#fbbf24'
  return '#d4d4d4'
}

function isFailureConclusion(conclusion: string | null): boolean {
  return !!conclusion && conclusion !== 'success' && conclusion !== 'skipped' && conclusion !== 'neutral'
}

/**
 * Slices a job log into one chunk per step.
 *
 * GitHub's raw job log marks each step with a `##[group]Run <cmd>` header, but the group only
 * wraps the *command echo* — the step's real output comes AFTER its `##[endgroup]`, up to the
 * next top-level group. So a step's chunk runs from its own group header until the next one,
 * which keeps the command AND its output together. Nested groups (Docker BuildKit emits its
 * own per build stage) are plain content, never boundaries.
 */
function sliceByStep(raw: string): string[][] {
  const chunks: string[][] = []
  let current: string[] = []
  let depth = 0

  for (const line of raw.split('\n')) {
    if (/##\[group\]/.test(line)) {
      if (depth === 0) {
        if (current.length) chunks.push(current)
        current = []
      }
      depth++
      current.push(line)
      continue
    }
    if (line.includes('##[endgroup]')) {
      depth = Math.max(0, depth - 1)
      continue // marker itself carries no content
    }
    current.push(line)
  }
  if (current.length) chunks.push(current)

  // Anything before the very first group (rare preamble) isn't a step — fold it into the first.
  return chunks
}

function StepIcon({ status, conclusion, size = 14 }: { status: string; conclusion: string | null; size?: number }) {
  if (status === 'in_progress') return <Loader2 size={size} className="animate-spin text-primary shrink-0" />
  if (status === 'queued') return <Clock size={size} className="text-yellow-500 shrink-0" />
  if (status === 'completed') {
    if (conclusion === 'success') return <CheckCircle2 size={size} className="text-green-500 shrink-0" />
    if (isFailureConclusion(conclusion)) return <XCircle size={size} className="text-destructive shrink-0" />
    return <AlertTriangle size={size} className="text-yellow-500 shrink-0" />
  }
  return <Circle size={size} className="text-muted-foreground shrink-0" />
}

const TERMINAL_JOB = ['completed']

export default function WorkflowRunModal({ owner, repo, runId, runName, initialStatus, initialConclusion, onClose }: Props) {
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [autoExpandDone, setAutoExpandDone] = useState(false)
  const stepRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  const { data: jobs } = useQuery({
    queryKey: ['cicd-run-jobs', owner, repo, runId],
    queryFn: () => getWorkflowJobs(owner, repo, runId),
    refetchInterval: q => {
      const js = q.state.data
      const allDone = js && js.length > 0 && js.every(j => TERMINAL_JOB.includes(j.status))
      return allDone ? false : 3000
    },
  })

  const allDone = !!jobs && jobs.length > 0 && jobs.every(j => TERMINAL_JOB.includes(j.status))
  const anyFailed = !!jobs && jobs.some(j => isFailureConclusion(j.conclusion))
  const runStatus = !jobs || jobs.length === 0
    ? (initialStatus === 'completed' ? (isFailureConclusion(initialConclusion) ? 'failure' : 'success') : initialStatus)
    : allDone ? (anyFailed ? 'failure' : 'success') : 'in_progress'

  useEffect(() => {
    if (selectedJobId !== null || !jobs?.length) return
    setSelectedJobId((jobs.find(j => j.status === 'in_progress') ?? jobs[0]).id)
  }, [jobs, selectedJobId])

  const selectedJob = jobs?.find(j => j.id === selectedJobId) ?? null
  const jobDone = selectedJob?.status === 'completed'
  const jobStarted = selectedJob ? selectedJob.status !== 'queued' : false
  const steps = useMemo(() => selectedJob?.steps ?? [], [selectedJob])

  // GitHub has no per-step streaming endpoint — re-download the job log every few seconds while
  // it runs, which is the documented way to approximate live logs.
  const { data: rawLog, isFetching: logFetching, error: logError } = useQuery({
    queryKey: ['cicd-run-job-log', owner, repo, selectedJobId],
    queryFn: () => getJobLogs(owner, repo, selectedJobId!),
    enabled: !!selectedJobId && jobStarted,
    refetchInterval: jobDone ? false : 4000,
    staleTime: jobDone ? 10_000 : 0,
    retry: false,
  })

  // Authoritative per-step logs: the run's log archive has one file per step, keyed by step
  // number. Only exists once the run is finished, so it's the preferred source when available
  // and the sliced whole-job log is the live fallback.
  const { data: stepLogs } = useQuery({
    queryKey: ['cicd-run-step-logs', owner, repo, runId, selectedJob?.name],
    queryFn: () => getRunStepLogs(owner, repo, runId, selectedJob!.name),
    enabled: !!selectedJob && jobDone,
    staleTime: 5 * 60_000,
    retry: false,
  })

  const chunks = useMemo(() => (rawLog ? sliceByStep(rawLog) : []), [rawLog])
  const hasAnyLog = chunks.length > 0 || Object.keys(stepLogs ?? {}).length > 0

  const linesForStep = (idx: number, stepNumber: number): string[] => {
    const exact = stepLogs?.[String(stepNumber)]
    if (exact !== undefined) return exact.split('\n')
    // Fallback while the run is still going: chunks appear in step order, trailing ones
    // (steps GitHub hasn't reported yet) fold into the last known step.
    if (!chunks.length) return []
    if (idx < steps.length - 1) return chunks[idx] ?? []
    return chunks.slice(idx).flat()
  }

  // Reset expansion when switching jobs so state doesn't leak across them.
  useEffect(() => {
    setExpanded(new Set())
    setAutoExpandDone(false)
  }, [selectedJobId])

  // Like GitHub: successful steps stay collapsed, the failing (or currently running) one opens.
  useEffect(() => {
    if (autoExpandDone || !steps.length || !hasAnyLog) return
    const failing = steps.findIndex(s => isFailureConclusion(s.conclusion))
    const running = steps.findIndex(s => s.status === 'in_progress')
    const target = failing >= 0 ? failing : running
    if (target >= 0) {
      setExpanded(new Set([target]))
      setAutoExpandDone(true)
      requestAnimationFrame(() => stepRefs.current.get(target)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    }
  }, [steps, hasAnyLog, autoExpandDone])

  const toggle = (i: number) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i); else next.add(i)
      return next
    })

  const expandAll = () => setExpanded(new Set(steps.map((_, i) => i)))
  const collapseAll = () => setExpanded(new Set())

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="flex flex-col w-full max-w-5xl bg-card border border-border rounded-xl overflow-hidden shadow-2xl" style={{ height: '88vh' }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {runStatus === 'in_progress' || runStatus === 'queued'
              ? <Loader2 size={16} className="animate-spin text-primary shrink-0" />
              : runStatus === 'success'
                ? <CheckCircle2 size={16} className="text-green-500 shrink-0" />
                : <XCircle size={16} className="text-destructive shrink-0" />}
            <span className="font-semibold text-sm text-foreground truncate">{runName}</span>
            <span className="text-[11px] font-mono text-muted-foreground shrink-0">#{runId}</span>
          </div>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 uppercase tracking-wider ${
            runStatus === 'success' ? 'status-online' : runStatus === 'failure' ? 'status-error' : 'status-building'
          }`}>
            {runStatus === 'in_progress' ? 'Running' : runStatus === 'queued' ? 'Queued' : runStatus}
          </span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors ml-1 shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Sidebar: jobs only (steps live in the main pane, like GitHub) */}
          <div className="flex flex-col shrink-0 overflow-y-auto border-r border-border" style={{ width: 220 }}>
            <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
              Jobs
            </div>
            {!jobs ? (
              <div className="flex items-center gap-2 px-4 py-6 text-xs text-muted-foreground">
                <Loader2 size={12} className="animate-spin" /> Loading…
              </div>
            ) : (
              jobs.map(job => {
                const active = job.id === selectedJobId
                return (
                  <button
                    key={job.id}
                    onClick={() => setSelectedJobId(job.id)}
                    className={`flex items-center gap-2 px-4 py-2.5 w-full text-left border-b border-border/50 transition-colors ${
                      active ? 'bg-muted/40 border-l-2 border-l-primary' : 'border-l-2 border-l-transparent hover:bg-muted/20'
                    }`}
                  >
                    <StepIcon status={job.status} conclusion={job.conclusion} />
                    <span className={`text-[12px] truncate ${active ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                      {job.name}
                    </span>
                  </button>
                )
              })
            )}
          </div>

          {/* Main pane: one collapsible row per step, GitHub-style */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#0a0a0a]">
            {!selectedJob ? (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground">Select a job</div>
            ) : !jobStarted ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-xs text-muted-foreground">
                <Clock size={16} /> Queued — hasn't started yet
              </div>
            ) : !hasAnyLog && logFetching ? (
              <div className="flex items-center justify-center h-full gap-2 text-xs text-muted-foreground">
                <Loader2 size={12} className="animate-spin" /> Loading logs…
              </div>
            ) : !hasAnyLog && logError ? (
              <div className="flex items-center justify-center h-full text-xs text-destructive px-6 text-center">
                {errorMessage(logError, 'Failed to load logs.')}
              </div>
            ) : !hasAnyLog ? (
              <div className="flex items-center justify-center h-full gap-2 text-xs text-muted-foreground">
                {jobDone ? 'No log output for this job.' : <><Loader2 size={12} className="animate-spin" /> No output yet…</>}
              </div>
            ) : (
              <>
                <div className="flex items-center justify-end gap-3 px-4 py-1.5 border-b border-white/5 shrink-0">
                  <button onClick={expandAll} className="text-[11px] text-neutral-400 hover:text-neutral-200">Expand all</button>
                  <button onClick={collapseAll} className="text-[11px] text-neutral-400 hover:text-neutral-200">Collapse all</button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {steps.map((step, i) => {
                    const open = expanded.has(i)
                    const lines = linesForStep(i, step.number)
                    return (
                      <div
                        key={`${step.number}-${step.name}`}
                        ref={el => { if (el) stepRefs.current.set(i, el) }}
                        className="border-b border-white/5"
                      >
                        <button
                          onClick={() => toggle(i)}
                          className="flex items-center gap-2.5 w-full text-left px-4 py-2.5 hover:bg-white/5 transition-colors"
                        >
                          {open
                            ? <ChevronDown size={13} className="shrink-0 text-neutral-500" />
                            : <ChevronRight size={13} className="shrink-0 text-neutral-500" />}
                          <StepIcon status={step.status} conclusion={step.conclusion} size={13} />
                          <span className="flex-1 text-[13px] text-neutral-200 truncate">{step.name}</span>
                          <span className="text-[10px] text-neutral-600 shrink-0">
                            {lines.length ? `${lines.length} lines` : '—'}
                          </span>
                        </button>
                        {open && (
                          <div className="font-mono text-[12px] leading-relaxed px-4 py-2 bg-black/40">
                            {lines.length === 0 ? (
                              <span className="text-neutral-600">No output for this step.</span>
                            ) : (
                              lines.map((line, li) => (
                                <div key={li} className="flex gap-3 hover:bg-white/5 px-1 -mx-1 rounded">
                                  <span className="select-none text-right shrink-0 w-8 text-neutral-700" style={{ fontSize: 11 }}>
                                    {li + 1}
                                  </span>
                                  <span style={{ color: lineColor(line), whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                    {cleanLine(line)}
                                  </span>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-border shrink-0">
          <span className="text-[11px] text-muted-foreground">
            {steps.length} step{steps.length !== 1 ? 's' : ''}
            {!jobDone && jobStarted && ' · polling every 4s'}
          </span>
          <button onClick={onClose} className={allDone ? 'btn-primary text-xs py-1.5 px-3.5' : 'btn-ghost text-xs py-1.5 px-3.5'}>
            {allDone ? 'Close' : 'Hide'}
          </button>
        </div>
      </div>
    </div>
  )
}
