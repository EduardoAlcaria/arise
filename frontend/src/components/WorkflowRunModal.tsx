import { useEffect, useMemo, useState } from 'react'
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

interface FlatStep {
  jobId: number
  jobName: string
  jobStatus: string
  name: string
  status: string
  conclusion: string | null
  number: number
}

interface LogSection {
  name: string
  lines: string[]
}

/** GitHub Actions raw logs wrap each step's output in ##[group]<name> / ##[endgroup] markers. */
function parseGithubLog(raw: string): LogSection[] {
  const lines = raw.split('\n')
  const sections: LogSection[] = []
  let current: LogSection | null = null
  for (const line of lines) {
    const groupMatch = line.match(/##\[group\](.*)$/)
    if (groupMatch) {
      current = { name: groupMatch[1].trim(), lines: [] }
      sections.push(current)
      continue
    }
    if (line.includes('##[endgroup]')) { current = null; continue }
    if (!current) {
      if (!sections.length || sections[0].name !== '__pre__') sections.unshift({ name: '__pre__', lines: [] })
      sections[0].lines.push(line)
    } else {
      current.lines.push(line)
    }
  }
  return sections
}

function stripTimestamp(line: string): string {
  return line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, '')
}

// Any conclusion other than 'success' (and non-null) counts as a failure for badge coloring —
// GitHub uses several: failure, cancelled, timed_out, action_required, stale, startup_failure.
function isFailureConclusion(conclusion: string | null): boolean {
  return !!conclusion && conclusion !== 'success' && conclusion !== 'skipped' && conclusion !== 'neutral'
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
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [autoFollow, setAutoFollow] = useState(true)

  const { data: jobs } = useQuery({
    queryKey: ['cicd-run-jobs', owner, repo, runId],
    queryFn: () => getWorkflowJobs(owner, repo, runId),
    refetchInterval: q => {
      const js = q.state.data
      const allDone = js && js.every(j => TERMINAL_JOB.includes(j.status))
      return allDone ? false : 3000
    },
  })

  const steps: FlatStep[] = useMemo(() => {
    if (!jobs) return []
    const out: FlatStep[] = []
    for (const job of jobs) {
      if (!job.steps || job.steps.length === 0) {
        out.push({ jobId: job.id, jobName: job.name, jobStatus: job.status, name: job.name, status: job.status, conclusion: job.conclusion, number: 0 })
        continue
      }
      for (const s of job.steps) {
        out.push({ jobId: job.id, jobName: job.name, jobStatus: job.status, name: s.name, status: s.status, conclusion: s.conclusion, number: s.number })
      }
    }
    return out
  }, [jobs])

  const allDone = !!jobs && jobs.length > 0 && jobs.every(j => TERMINAL_JOB.includes(j.status))
  const anyFailed = !!jobs && jobs.some(j => isFailureConclusion(j.conclusion))
  // Jobs can take a moment to appear (or the run has none yet) — fall back to the run's own
  // status/conclusion from the runs list instead of defaulting to "queued" while jobs are empty.
  const runStatus = !jobs || jobs.length === 0
    ? (initialStatus === 'completed' ? (isFailureConclusion(initialConclusion) ? 'failure' : 'success') : initialStatus)
    : allDone ? (anyFailed ? 'failure' : 'success') : 'in_progress'

  // Auto-follow the currently running step
  useEffect(() => {
    if (!autoFollow) return
    const idx = steps.findIndex(s => s.status === 'in_progress')
    if (idx >= 0) setSelectedIdx(idx)
  }, [steps, autoFollow])

  const selected = steps[selectedIdx] ?? null

  const jobDone = (jobId: number) => jobs?.find(j => j.id === jobId)?.status === 'completed'

  const { data: rawLog, isLoading: logLoading, error: logError } = useQuery({
    queryKey: ['cicd-run-job-log', owner, repo, selected?.jobId],
    queryFn: () => getJobLogs(owner, repo, selected!.jobId),
    enabled: !!selected && jobDone(selected.jobId),
    staleTime: 10_000,
    retry: false,
  })

  const parsedSections = useMemo(() => (rawLog ? parseGithubLog(rawLog) : []), [rawLog])

  // Match the selected step to its log section: prefer exact/contains name match, else positional order.
  const stepLines: string[] = useMemo(() => {
    if (!selected || parsedSections.length === 0) return []
    const named = parsedSections.filter(s => s.name !== '__pre__')
    const byName = named.find(s => s.name.toLowerCase() === selected.name.toLowerCase())
      ?? named.find(s => s.name.toLowerCase().includes(selected.name.toLowerCase()) || selected.name.toLowerCase().includes(s.name.toLowerCase()))
    if (byName) return byName.lines
    const idx = jobs?.find(j => j.id === selected.jobId)?.steps?.findIndex(s => s.number === selected.number) ?? -1
    if (idx >= 0 && named[idx]) return named[idx].lines
    return []
  }, [selected, parsedSections, jobs])

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
          {/* Sidebar: jobs + steps */}
          <div className="flex flex-col shrink-0 overflow-y-auto border-r border-border" style={{ width: 280 }}>
            {!jobs ? (
              <div className="flex items-center gap-2 px-4 py-6 text-xs text-muted-foreground">
                <Loader2 size={12} className="animate-spin" /> Loading jobs…
              </div>
            ) : (
              jobs.map(job => (
                <div key={job.id}>
                  <div className="flex items-center gap-2 px-4 py-2 bg-muted/20 border-b border-border">
                    <StepIcon status={job.status} conclusion={job.conclusion} />
                    <span className="text-[12px] font-semibold text-foreground truncate">{job.name}</span>
                  </div>
                  {steps.filter(s => s.jobId === job.id).map((step, localIdx) => {
                    const idx = steps.indexOf(step)
                    const active = selectedIdx === idx
                    return (
                      <button
                        key={`${job.id}-${step.number}-${localIdx}`}
                        onClick={() => { setSelectedIdx(idx); setAutoFollow(false) }}
                        className={`flex items-center gap-2.5 pl-7 pr-4 py-2 text-left w-full transition-colors shrink-0 border-b border-border/50 ${
                          active ? 'bg-muted/30 border-l-2 border-l-primary' : 'border-l-2 border-l-transparent hover:bg-muted/10'
                        }`}
                      >
                        <StepIcon status={step.status} conclusion={step.conclusion} />
                        <span className={`text-[12px] truncate ${active ? 'text-foreground' : 'text-muted-foreground'}`}>{step.name}</span>
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>

          {/* Log panel — dark/monospace regardless of theme, standard for log viewers */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#0a0a0a]">
            {!selected ? (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                Select a step to view logs
              </div>
            ) : !jobDone(selected.jobId) ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-xs text-muted-foreground">
                <Loader2 size={16} className="animate-spin" />
                Waiting for step to finish — GitHub only serves logs once a job completes
              </div>
            ) : logLoading ? (
              <div className="flex items-center justify-center h-full gap-2 text-xs text-muted-foreground">
                <Loader2 size={12} className="animate-spin" /> Loading logs…
              </div>
            ) : logError ? (
              <div className="flex items-center justify-center h-full text-xs text-destructive px-6 text-center">
                {errorMessage(logError, 'Failed to load logs.')}
              </div>
            ) : stepLines.length === 0 ? (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                No log output for this step.
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto font-mono text-[12px] leading-relaxed px-4 py-3">
                {stepLines.map((line, j) => (
                  <div key={j} className="flex gap-3 hover:bg-white/5 px-1 -mx-1 rounded">
                    <span className="select-none text-right shrink-0 w-8 text-neutral-600" style={{ fontSize: 11 }}>{j + 1}</span>
                    <span className="text-neutral-300 whitespace-pre-wrap break-all">{stripTimestamp(line)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-border shrink-0">
          <span className="text-[11px] text-muted-foreground">
            {steps.length} step{steps.length !== 1 ? 's' : ''}{!allDone && ' · live'}
          </span>
          <div className="flex items-center gap-3">
            {!autoFollow && !allDone && (
              <button onClick={() => setAutoFollow(true)} className="flex items-center gap-1.5 text-[12px] text-primary transition-colors">
                <ArrowDown size={12} /> Follow live step
              </button>
            )}
            <button onClick={onClose} className={allDone ? 'btn-primary text-xs py-1.5 px-3.5' : 'btn-ghost text-xs py-1.5 px-3.5'}>
              {allDone ? 'Close' : 'Hide'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
