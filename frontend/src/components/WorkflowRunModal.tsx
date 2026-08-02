import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getWorkflowJobs, getJobLogs } from '../api/cicd'
import { errorMessage } from './ErrorBanner'
import { X, CheckCircle2, XCircle, Loader2, Circle, Clock, AlertTriangle, ArrowDown } from 'lucide-react'

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

// GitHub's own log view renders group markers as collapsible headers; we just drop the marker
// text and keep the content, so nothing in the output is hidden.
function cleanLine(line: string): string {
  return stripAnsi(stripTimestamp(line))
    .replace(/##\[group\]/g, '')
    .replace(/##\[endgroup\]/g, '')
    .replace(/##\[(error|warning|notice|debug|command)\]/g, '')
}

// Any conclusion other than 'success' (and non-null) counts as a failure for badge coloring —
// GitHub uses several: failure, cancelled, timed_out, action_required, stale, startup_failure.
function isFailureConclusion(conclusion: string | null): boolean {
  return !!conclusion && conclusion !== 'success' && conclusion !== 'skipped' && conclusion !== 'neutral'
}

function lineColor(raw: string): string {
  if (raw.includes('##[error]')) return '#f87171'
  if (raw.includes('##[warning]')) return '#fbbf24'
  if (raw.includes('##[group]')) return '#93c5fd'
  return '#d4d4d4'
}

function StepIcon({ status, conclusion }: { status: string; conclusion: string | null }) {
  if (status === 'in_progress') return <Loader2 size={14} className="animate-spin text-primary shrink-0" />
  if (status === 'queued') return <Clock size={14} className="text-yellow-500 shrink-0" />
  if (status === 'completed') {
    if (conclusion === 'success') return <CheckCircle2 size={14} className="text-green-500 shrink-0" />
    if (isFailureConclusion(conclusion)) return <XCircle size={14} className="text-destructive shrink-0" />
    return <AlertTriangle size={14} className="text-yellow-500 shrink-0" />
  }
  return <Circle size={14} className="text-muted-foreground shrink-0" />
}

const TERMINAL_JOB = ['completed']

export default function WorkflowRunModal({ owner, repo, runId, runName, initialStatus, initialConclusion, onClose }: Props) {
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

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
  // Jobs can take a moment to appear (or the run has none yet) — fall back to the run's own
  // status/conclusion from the runs list instead of defaulting to "queued" while jobs are empty.
  const runStatus = !jobs || jobs.length === 0
    ? (initialStatus === 'completed' ? (isFailureConclusion(initialConclusion) ? 'failure' : 'success') : initialStatus)
    : allDone ? (anyFailed ? 'failure' : 'success') : 'in_progress'

  // Default to the running job, else the first one.
  useEffect(() => {
    if (selectedJobId !== null || !jobs?.length) return
    setSelectedJobId((jobs.find(j => j.status === 'in_progress') ?? jobs[0]).id)
  }, [jobs, selectedJobId])

  const selectedJob = jobs?.find(j => j.id === selectedJobId) ?? null
  const jobDone = selectedJob?.status === 'completed'
  const jobStarted = selectedJob ? selectedJob.status !== 'queued' : false

  // GitHub's API has no per-step streaming endpoint — the documented approach is to re-download
  // the job log every few seconds while the job runs. Poll here and render the WHOLE log,
  // unsliced, so nothing the runner printed is hidden.
  const { data: rawLog, isFetching: logFetching, error: logError } = useQuery({
    queryKey: ['cicd-run-job-log', owner, repo, selectedJobId],
    queryFn: () => getJobLogs(owner, repo, selectedJobId!),
    enabled: !!selectedJobId && jobStarted,
    refetchInterval: jobDone ? false : 4000,
    staleTime: jobDone ? 10_000 : 0,
    retry: false,
  })

  const lines = useMemo(() => (rawLog ? rawLog.split('\n') : []), [rawLog])

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines.length, autoScroll])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 60)
  }

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
          {/* Sidebar: jobs (selectable) + their steps (status only) */}
          <div className="flex flex-col shrink-0 overflow-y-auto border-r border-border" style={{ width: 280 }}>
            {!jobs ? (
              <div className="flex items-center gap-2 px-4 py-6 text-xs text-muted-foreground">
                <Loader2 size={12} className="animate-spin" /> Loading jobs…
              </div>
            ) : (
              jobs.map(job => {
                const active = job.id === selectedJobId
                return (
                  <div key={job.id}>
                    <button
                      onClick={() => { setSelectedJobId(job.id); setAutoScroll(true) }}
                      className={`flex items-center gap-2 px-4 py-2 w-full text-left border-b border-border transition-colors ${
                        active ? 'bg-muted/40 border-l-2 border-l-primary' : 'bg-muted/10 border-l-2 border-l-transparent hover:bg-muted/20'
                      }`}
                    >
                      <StepIcon status={job.status} conclusion={job.conclusion} />
                      <span className="text-[12px] font-semibold text-foreground truncate">{job.name}</span>
                    </button>
                    {(job.steps ?? []).map(step => (
                      <div
                        key={`${job.id}-${step.number}`}
                        className="flex items-center gap-2.5 pl-7 pr-4 py-2 border-b border-border/50"
                      >
                        <StepIcon status={step.status} conclusion={step.conclusion} />
                        <span className="text-[12px] text-muted-foreground truncate">{step.name}</span>
                      </div>
                    ))}
                  </div>
                )
              })
            )}
          </div>

          {/* Log panel — full job output, dark/monospace regardless of theme */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#0a0a0a]">
            {!selectedJob ? (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                Select a job to view its logs
              </div>
            ) : !jobStarted ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-xs text-muted-foreground">
                <Clock size={16} /> Queued — hasn't started yet
              </div>
            ) : lines.length > 0 ? (
              <>
                <div
                  ref={scrollRef}
                  onScroll={onScroll}
                  className="flex-1 overflow-y-auto font-mono text-[12px] leading-relaxed px-4 py-3"
                >
                  {lines.map((line, i) => (
                    <div key={i} className="flex gap-3 hover:bg-white/5 px-1 -mx-1 rounded">
                      <span className="select-none text-right shrink-0 w-10 text-neutral-600" style={{ fontSize: 11 }}>{i + 1}</span>
                      <span style={{ color: lineColor(line), whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{cleanLine(line)}</span>
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </div>
                <div className="flex items-center justify-between px-4 py-2 border-t border-border/30 shrink-0">
                  <span className="text-[11px] text-neutral-500">
                    {lines.length} line{lines.length !== 1 ? 's' : ''}
                    {!jobDone && ' · polling every 4s'}
                  </span>
                  {!autoScroll && (
                    <button
                      onClick={() => { setAutoScroll(true); bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }}
                      className="flex items-center gap-1.5 text-[12px] text-primary transition-colors"
                    >
                      <ArrowDown size={12} /> Bottom
                    </button>
                  )}
                </div>
              </>
            ) : logFetching ? (
              <div className="flex items-center justify-center h-full gap-2 text-xs text-muted-foreground">
                <Loader2 size={12} className="animate-spin" /> Loading logs…
              </div>
            ) : logError ? (
              <div className="flex items-center justify-center h-full text-xs text-destructive px-6 text-center">
                {errorMessage(logError, 'Failed to load logs.')}
              </div>
            ) : jobDone ? (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                No log output for this job.
              </div>
            ) : (
              <div className="flex items-center justify-center h-full gap-2 text-xs text-muted-foreground">
                <Loader2 size={12} className="animate-spin" /> No output yet — still running…
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-border shrink-0">
          <span className="text-[11px] text-muted-foreground">
            {jobs?.length ?? 0} job{(jobs?.length ?? 0) !== 1 ? 's' : ''}{!allDone && ' · live'}
          </span>
          <button onClick={onClose} className={allDone ? 'btn-primary text-xs py-1.5 px-3.5' : 'btn-ghost text-xs py-1.5 px-3.5'}>
            {allDone ? 'Close' : 'Hide'}
          </button>
        </div>
      </div>
    </div>
  )
}
