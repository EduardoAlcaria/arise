import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getWorkflowJobs, getJobLogs, type WorkflowJob } from '../api/cicd'
import { X, CheckCircle2, XCircle, Loader2, Circle, Clock, AlertTriangle, ArrowDown } from 'lucide-react'

interface Props {
  owner: string
  repo: string
  runId: number
  runName: string
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

function StepIcon({ status, conclusion }: { status: string; conclusion: string | null }) {
  if (status === 'in_progress') return <Loader2 size={14} className="animate-spin text-blue-400 shrink-0" />
  if (status === 'queued') return <Clock size={14} className="shrink-0" style={{ color: '#d29922' }} />
  if (status === 'completed') {
    if (conclusion === 'success') return <CheckCircle2 size={14} className="shrink-0" style={{ color: '#3fb950' }} />
    if (conclusion === 'failure') return <XCircle size={14} className="shrink-0" style={{ color: '#f85149' }} />
    if (conclusion === 'cancelled') return <Circle size={14} className="shrink-0" style={{ color: '#484f58' }} />
    return <AlertTriangle size={14} className="shrink-0" style={{ color: '#d29922' }} />
  }
  return <Circle size={14} className="shrink-0" style={{ color: '#484f58' }} />
}

const TERMINAL_JOB = ['completed']

export default function WorkflowRunModal({ owner, repo, runId, runName, onClose }: Props) {
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

  const allDone = !!jobs && jobs.every(j => TERMINAL_JOB.includes(j.status))
  const anyFailed = !!jobs && jobs.some(j => j.conclusion === 'failure')
  const runStatus = !jobs || jobs.length === 0 ? 'queued' : allDone ? (anyFailed ? 'failure' : 'success') : 'in_progress'

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm" style={{ background: 'rgba(1,4,9,0.88)' }}>
      <div className="flex flex-col w-full max-w-5xl rounded-xl overflow-hidden" style={{ height: '88vh', background: '#0d1117', border: '1px solid #30363d', boxShadow: '0 24px 64px rgba(0,0,0,0.8)' }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 shrink-0" style={{ borderBottom: '1px solid #21262d', background: '#161b22' }}>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {runStatus === 'in_progress' || runStatus === 'queued'
              ? <Loader2 size={16} className="animate-spin shrink-0" style={{ color: '#58a6ff' }} />
              : runStatus === 'success'
                ? <CheckCircle2 size={16} style={{ color: '#3fb950', flexShrink: 0 }} />
                : <XCircle size={16} style={{ color: '#f85149', flexShrink: 0 }} />}
            <span className="font-semibold text-sm truncate" style={{ color: '#e6edf3' }}>{runName}</span>
            <span className="text-[11px] font-mono shrink-0" style={{ color: '#484f58' }}>#{runId}</span>
          </div>
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 uppercase tracking-wider"
            style={{
              background: runStatus === 'success' ? '#1a3828' : runStatus === 'failure' ? '#3d1a1a' : '#1a2638',
              color: runStatus === 'success' ? '#3fb950' : runStatus === 'failure' ? '#f85149' : '#58a6ff',
              border: `1px solid ${runStatus === 'success' ? '#3fb95030' : runStatus === 'failure' ? '#f8514930' : '#58a6ff30'}`,
            }}
          >
            {runStatus === 'in_progress' ? 'Running' : runStatus === 'queued' ? 'Queued' : runStatus}
          </span>
          <button onClick={onClose} style={{ color: '#484f58' }} className="hover:text-white transition-colors ml-1 shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Sidebar: jobs + steps */}
          <div className="flex flex-col shrink-0 overflow-y-auto" style={{ width: 280, borderRight: '1px solid #21262d', background: '#0d1117' }}>
            {!jobs ? (
              <div className="flex items-center gap-2 px-4 py-6 text-xs" style={{ color: '#484f58' }}>
                <Loader2 size={12} className="animate-spin" /> Loading jobs…
              </div>
            ) : (
              jobs.map(job => (
                <div key={job.id}>
                  <div className="flex items-center gap-2 px-4 py-2" style={{ background: '#161b22', borderBottom: '1px solid #21262d' }}>
                    <StepIcon status={job.status} conclusion={job.conclusion} />
                    <span className="text-[12px] font-semibold truncate" style={{ color: '#e6edf3' }}>{job.name}</span>
                  </div>
                  {steps.filter(s => s.jobId === job.id).map((step, localIdx) => {
                    const idx = steps.indexOf(step)
                    const active = selectedIdx === idx
                    return (
                      <button
                        key={`${job.id}-${step.number}-${localIdx}`}
                        onClick={() => { setSelectedIdx(idx); setAutoFollow(false) }}
                        className="flex items-center gap-2.5 pl-7 pr-4 py-2 text-left w-full transition-colors shrink-0"
                        style={{
                          background: active ? '#161b22' : 'transparent',
                          borderLeft: active ? '2px solid #58a6ff' : '2px solid transparent',
                          borderBottom: '1px solid #21262d',
                        }}
                        onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#111317' }}
                        onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
                      >
                        <StepIcon status={step.status} conclusion={step.conclusion} />
                        <span className="text-[12px] truncate" style={{ color: active ? '#e6edf3' : '#8b949e' }}>{step.name}</span>
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>

          {/* Log panel */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0" style={{ background: '#010409' }}>
            {!selected ? (
              <div className="flex items-center justify-center h-full text-xs" style={{ color: '#484f58' }}>
                Select a step to view logs
              </div>
            ) : !jobDone(selected.jobId) ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-xs" style={{ color: '#484f58' }}>
                <Loader2 size={16} className="animate-spin" />
                Waiting for step to finish — GitHub only serves logs once a job completes
              </div>
            ) : logLoading ? (
              <div className="flex items-center justify-center h-full gap-2 text-xs" style={{ color: '#484f58' }}>
                <Loader2 size={12} className="animate-spin" /> Loading logs…
              </div>
            ) : logError ? (
              <div className="flex items-center justify-center h-full text-xs" style={{ color: '#f85149' }}>
                Failed to load logs.
              </div>
            ) : stepLines.length === 0 ? (
              <div className="flex items-center justify-center h-full text-xs" style={{ color: '#484f58' }}>
                No log output for this step.
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto font-mono text-[12px] leading-relaxed px-4 py-3">
                {stepLines.map((line, j) => (
                  <div key={j} className="flex gap-3 hover:bg-white/5 px-1 -mx-1 rounded">
                    <span className="select-none text-right shrink-0 w-8" style={{ color: '#3d444d', fontSize: 11 }}>{j + 1}</span>
                    <span style={{ color: '#8b949e', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{stripTimestamp(line)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-2.5 shrink-0" style={{ borderTop: '1px solid #21262d', background: '#161b22' }}>
          <span className="text-[11px]" style={{ color: '#484f58' }}>
            {steps.length} step{steps.length !== 1 ? 's' : ''}{!allDone && ' · live'}
          </span>
          <div className="flex items-center gap-3">
            {!autoFollow && !allDone && (
              <button onClick={() => setAutoFollow(true)} className="flex items-center gap-1.5 text-[12px] transition-colors" style={{ color: '#58a6ff' }}>
                <ArrowDown size={12} /> Follow live step
              </button>
            )}
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors"
              style={{ background: allDone ? '#238636' : '#30363d', color: '#fff' }}
              onMouseEnter={e => (e.currentTarget.style.background = allDone ? '#2ea043' : '#444c56')}
              onMouseLeave={e => (e.currentTarget.style.background = allDone ? '#238636' : '#30363d')}
            >
              {allDone ? 'Close' : 'Hide'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
