import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getWorkflows, getWorkflowRuns, getWorkflowJobs, listRunners,
  rerunWorkflow, triggerWorkflow, triggerByPush, deleteRunner, setupRunner,
  type WorkflowRun, type WorkflowJob, type Runner,
} from '../api/cicd'
import { getDeployments } from '../api/deployments'
import { getMachines } from '../api/machines'
import {
  GitBranch, Play, RotateCcw, Trash2, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, Clock, Loader2, Circle, Server, Workflow,
  Zap, RefreshCw, AlertTriangle, Copy, Check,
} from 'lucide-react'

// ── helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function extractOwnerRepo(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/)
  if (!m) return null
  return { owner: m[1], repo: m[2] }
}

function StatusIcon({ status, conclusion }: { status: string; conclusion: string | null }) {
  if (status === 'completed') {
    if (conclusion === 'success') return <CheckCircle2 size={14} className="text-green-400 shrink-0" />
    if (conclusion === 'failure') return <XCircle size={14} className="text-red-400 shrink-0" />
    if (conclusion === 'cancelled') return <Circle size={14} className="text-muted-foreground shrink-0" />
    return <AlertTriangle size={14} className="text-yellow-400 shrink-0" />
  }
  if (status === 'in_progress') return <Loader2 size={14} className="text-blue-400 animate-spin shrink-0" />
  if (status === 'queued') return <Clock size={14} className="text-yellow-400 shrink-0" />
  return <Circle size={14} className="text-muted-foreground shrink-0" />
}

function statusBadge(status: string, conclusion: string | null): string {
  if (status === 'completed') {
    if (conclusion === 'success') return 'status-online'
    if (conclusion === 'failure') return 'status-error'
    return 'status-muted'
  }
  if (status === 'in_progress') return 'status-building'
  return 'status-muted'
}

function conclusionLabel(status: string, conclusion: string | null): string {
  if (status === 'in_progress') return 'Running'
  if (status === 'queued') return 'Queued'
  return conclusion ? conclusion.replace('_', ' ') : status
}

// ── Run row with expandable jobs ──────────────────────────────────────────────

function RunRow({
  run, owner, repo,
  onRerun,
}: {
  run: WorkflowRun
  owner: string
  repo: string
  onRerun: (runId: number) => void
}) {
  const [open, setOpen] = useState(false)

  const { data: jobs, isLoading: jobsLoading } = useQuery({
    queryKey: ['cicd-jobs', owner, repo, run.id],
    queryFn: () => getWorkflowJobs(owner, repo, run.id),
    enabled: open,
    staleTime: 15_000,
  })

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <StatusIcon status={run.status} conclusion={run.conclusion} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground truncate">{run.name}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium uppercase tracking-wide ${statusBadge(run.status, run.conclusion)}`}>
              {conclusionLabel(run.status, run.conclusion)}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <GitBranch size={10} /> {run.headBranch}
            </span>
            <span>{run.event}</span>
            <span>{timeAgo(run.createdAt)}</span>
          </div>
        </div>
        <button
          onClick={e => { e.stopPropagation(); onRerun(run.id) }}
          title="Re-run"
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        >
          <RotateCcw size={13} />
        </button>
        {open ? <ChevronDown size={14} className="text-muted-foreground shrink-0" /> : <ChevronRight size={14} className="text-muted-foreground shrink-0" />}
      </div>

      {open && (
        <div className="border-t border-border bg-muted/10 px-4 py-3 space-y-2">
          {jobsLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" /> Loading jobs…
            </div>
          )}
          {jobs?.map(job => (
            <JobRow key={job.id} job={job} />
          ))}
          {jobs?.length === 0 && (
            <p className="text-xs text-muted-foreground">No jobs found.</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Job row with steps ────────────────────────────────────────────────────────

function JobRow({ job }: { job: WorkflowJob }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-border/50 rounded-md overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/20 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <StatusIcon status={job.status} conclusion={job.conclusion} />
        <span className="flex-1 text-xs font-medium text-foreground truncate">{job.name}</span>
        <a
          href={job.htmlUrl}
          target="_blank"
          rel="noreferrer"
          onClick={e => e.stopPropagation()}
          className="text-[10px] text-muted-foreground hover:text-primary transition-colors shrink-0"
        >
          View ↗
        </a>
        {job.steps && job.steps.length > 0 && (
          open ? <ChevronDown size={12} className="text-muted-foreground shrink-0" /> : <ChevronRight size={12} className="text-muted-foreground shrink-0" />
        )}
      </div>
      {open && job.steps && (
        <div className="border-t border-border/50 px-3 py-2 space-y-1">
          {job.steps.sort((a, b) => a.number - b.number).map(step => (
            <div key={step.number} className="flex items-center gap-2">
              <StatusIcon status={step.status} conclusion={step.conclusion} />
              <span className="text-[11px] text-muted-foreground truncate">{step.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Trigger modal ─────────────────────────────────────────────────────────────

function TriggerModal({
  owner, repo, workflows,
  onClose,
}: {
  owner: string; repo: string; workflows: string[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [workflow, setWorkflow] = useState(workflows[0] ?? '')
  const [ref, setRef] = useState('main')
  const [mode, setMode] = useState<'dispatch' | 'push'>('dispatch')

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['cicd-runs', owner, repo] })
    onClose()
  }

  const dispatchMut = useMutation({
    mutationFn: () => triggerWorkflow(owner, repo, workflow, ref),
    onSuccess: invalidate,
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? ''
      if (msg.includes('workflow_dispatch')) setMode('push')
    },
  })

  const pushMut = useMutation({
    mutationFn: () => triggerByPush(owner, repo, ref),
    onSuccess: invalidate,
  })

  const activeMut = mode === 'dispatch' ? dispatchMut : pushMut

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-card border border-border rounded-xl p-6 w-full max-w-sm shadow-2xl space-y-4">
        <h2 className="text-sm font-semibold">Trigger Workflow</h2>

        {/* Mode toggle */}
        <div className="flex rounded-lg border border-border overflow-hidden text-xs font-medium">
          {(['dispatch', 'push'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="flex-1 py-2 capitalize transition-colors"
              style={{
                background: mode === m ? 'var(--color-primary)' : 'transparent',
                color: mode === m ? 'var(--color-primary-foreground)' : 'var(--color-muted-foreground)',
              }}
            >
              {m === 'dispatch' ? 'workflow_dispatch' : 'Push commit'}
            </button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          {mode === 'dispatch'
            ? 'Trigger via GitHub\'s workflow_dispatch event. Requires the workflow to have on: workflow_dispatch.'
            : 'Pushes a small trigger file (.arise/deploy-trigger) to the repo, firing on: push workflows.'}
        </p>

        <div className="space-y-3">
          {mode === 'dispatch' && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Workflow</label>
              <select
                value={workflow}
                onChange={e => setWorkflow(e.target.value)}
                className="input w-full"
              >
                {workflows.map(w => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Branch</label>
            <input
              value={ref}
              onChange={e => setRef(e.target.value)}
              className="input w-full"
              placeholder="main"
            />
          </div>
        </div>

        {activeMut.error && (
          <p className="text-xs text-destructive">
            {(activeMut.error as any)?.response?.data?.message ?? 'Failed to trigger'}
          </p>
        )}
        {activeMut.isSuccess && (
          <p className="text-xs text-green-400">Triggered — run should appear shortly.</p>
        )}

        <div className="flex gap-2 justify-end">
          <button className="btn-ghost text-sm" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary text-sm flex items-center gap-1.5"
            onClick={() => activeMut.mutate()}
            disabled={activeMut.isPending || (mode === 'dispatch' && !workflow)}
          >
            {activeMut.isPending && <Loader2 size={12} className="animate-spin" />}
            <Play size={12} /> {mode === 'dispatch' ? 'Trigger' : 'Push & Trigger'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Runner setup modal ────────────────────────────────────────────────────────

function SetupRunnerModal({
  owner, repo,
  onClose,
}: {
  owner: string; repo: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const { data: machines } = useQuery({ queryKey: ['machines'], queryFn: getMachines })
  const [machineId, setMachineId] = useState<number | ''>('')

  const [started, setStarted] = useState(false)

  const setupMut = useMutation({
    mutationFn: () => setupRunner(owner, repo, machineId as number),
    onSuccess: () => {
      setStarted(true)
      // Poll runners after 30s to check if it appeared
      setTimeout(() => qc.invalidateQueries({ queryKey: ['cicd-runners'] }), 30_000)
    },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-card border border-border rounded-xl p-6 w-full max-w-sm shadow-2xl space-y-4">
        <h2 className="text-sm font-semibold">Set Up Self-Hosted Runner</h2>
        {!started ? (
          <>
            <p className="text-xs text-muted-foreground">
              Detects OS/arch, downloads the correct GitHub Actions runner binary via SSH, and registers it with GitHub.
              Requires the machine's SSH user to have <code>sudo</code> access (Linux) or standard access (macOS).
            </p>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Machine</label>
              <select
                value={machineId}
                onChange={e => setMachineId(Number(e.target.value))}
                className="input w-full"
              >
                <option value="">Select machine…</option>
                {machines?.map(m => (
                  <option key={m.id} value={m.id}>{m.name} ({m.host})</option>
                ))}
              </select>
            </div>
            {setupMut.error && (
              <p className="text-xs text-destructive">
                {(setupMut.error as any)?.response?.data?.message ?? 'Setup failed'}
              </p>
            )}
          </>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-green-400 text-sm">
              <Loader2 size={14} className="animate-spin" />
              Runner setup running on machine…
            </div>
            <p className="text-xs text-muted-foreground">
              This takes ~1–2 minutes. The runner will appear in the Runners tab once registered.
              You can close this dialog — setup continues in the background.
            </p>
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <button className="btn-ghost text-sm" onClick={onClose}>{started ? 'Close' : 'Cancel'}</button>
          {!started && (
            <button
              className="btn-primary text-sm flex items-center gap-1.5"
              onClick={() => setupMut.mutate()}
              disabled={setupMut.isPending || !machineId}
            >
              {setupMut.isPending && <Loader2 size={12} className="animate-spin" />}
              <Server size={12} /> Set Up
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Workflow template ─────────────────────────────────────────────────────────

function WorkflowTemplate({ owner, repo }: { owner: string; repo: string }) {
  const [copied, setCopied] = useState(false)
  const template = `name: CI

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]
  workflow_dispatch:

jobs:
  build:
    runs-on: self-hosted

    steps:
      - uses: actions/checkout@v4

      - name: Run tests
        run: |
          echo "Add your build/test steps here"

      - name: Deploy
        run: |
          echo "Add your deploy steps here"
`

  const copy = () => {
    navigator.clipboard.writeText(template)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
        <Zap size={28} className="opacity-20" />
        <p className="text-sm opacity-70">No workflow files found in <code className="text-xs bg-muted px-1 rounded">.github/workflows/</code></p>
        <p className="text-xs opacity-50">Add a workflow file to your repo to get started.</p>
      </div>
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
          <span className="text-xs font-medium text-muted-foreground font-mono">.github/workflows/ci.yml</span>
          <button
            onClick={copy}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <pre className="p-4 text-xs font-mono text-foreground leading-relaxed overflow-x-auto bg-muted/10 whitespace-pre">
          {template}
        </pre>
      </div>
      <p className="text-xs text-muted-foreground">
        Commit this file to <code className="bg-muted px-1 rounded">{owner}/{repo}</code> and set up a self-hosted runner in the Runners tab.
      </p>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = 'runs' | 'workflows' | 'runners'

export default function CiCd() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('runs')
  const [selectedRepo, setSelectedRepo] = useState<string>('')
  const [showTrigger, setShowTrigger] = useState(false)
  const [showSetupRunner, setShowSetupRunner] = useState(false)

  const { data: deploymentsPage } = useQuery({
    queryKey: ['deployments'],
    queryFn: () => getDeployments(0, 100),
    staleTime: 60_000,
  })

  const repos = deploymentsPage
    ? [...new Map(
        deploymentsPage.content
          .filter(d => d.repositoryUrl?.includes('github.com'))
          .map(d => {
            const p = extractOwnerRepo(d.repositoryUrl!)
            return p ? [`${p.owner}/${p.repo}`, `${p.owner}/${p.repo}`] : null
          })
          .filter(Boolean) as [string, string][]
      ).values()]
    : []

  const parsed = selectedRepo ? extractOwnerRepo(`github.com/${selectedRepo}`) : null
  const owner = parsed?.owner ?? ''
  const repo = parsed?.repo ?? ''

  const { data: runs, isLoading: runsLoading, refetch: refetchRuns } = useQuery({
    queryKey: ['cicd-runs', owner, repo],
    queryFn: () => getWorkflowRuns(owner, repo),
    enabled: !!owner && !!repo && tab === 'runs',
    refetchInterval: tab === 'runs' ? 30_000 : false,
    staleTime: 15_000,
  })

  const { data: workflows, isLoading: workflowsLoading } = useQuery({
    queryKey: ['cicd-workflows', owner, repo],
    queryFn: () => getWorkflows(owner, repo),
    enabled: !!owner && !!repo && tab === 'workflows',
    staleTime: 60_000,
  })

  const { data: runners, isLoading: runnersLoading, refetch: refetchRunners } = useQuery({
    queryKey: ['cicd-runners', owner, repo],
    queryFn: () => listRunners(owner, repo),
    enabled: !!owner && !!repo && tab === 'runners',
    staleTime: 30_000,
  })

  const rerunMut = useMutation({
    mutationFn: (runId: number) => rerunWorkflow(owner, repo, runId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cicd-runs'] }),
  })

  const deleteRunnerMut = useMutation({
    mutationFn: (runnerId: number) => deleteRunner(owner, repo, runnerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cicd-runners'] }),
  })

  const TABS: { id: Tab; label: string; icon: typeof Workflow }[] = [
    { id: 'runs', label: 'Runs', icon: Workflow },
    { id: 'workflows', label: 'Workflows', icon: Zap },
    { id: 'runners', label: 'Runners', icon: Server },
  ]

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold">CI/CD</h1>
          <p className="text-xs text-muted-foreground mt-0.5">GitHub Actions pipelines and self-hosted runners</p>
        </div>

        {/* Repo selector */}
        <select
          value={selectedRepo}
          onChange={e => setSelectedRepo(e.target.value)}
          className="input w-64"
        >
          <option value="">Select repository…</option>
          {repos.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {!selectedRepo && (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
          <GitBranch size={32} className="opacity-20" />
          <p className="text-sm opacity-50">Select a repository to view its CI/CD pipelines.</p>
          {repos.length === 0 && (
            <p className="text-xs opacity-40">No GitHub deployments found. Deploy a repo first.</p>
          )}
        </div>
      )}

      {selectedRepo && (
        <>
          {/* Tabs */}
          <div className="flex items-center gap-1 border-b border-border pb-0">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === id
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2 pb-1">
              {tab === 'runs' && (
                <button
                  onClick={() => refetchRuns()}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Refresh"
                >
                  <RefreshCw size={13} />
                </button>
              )}
              {tab === 'workflows' && workflows && workflows.length > 0 && (
                <button
                  onClick={() => setShowTrigger(true)}
                  className="btn-primary text-xs flex items-center gap-1.5 py-1.5 px-3"
                >
                  <Play size={11} /> Trigger
                </button>
              )}
              {tab === 'runners' && (
                <>
                  <button
                    onClick={() => refetchRunners()}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="Refresh"
                  >
                    <RefreshCw size={13} />
                  </button>
                  <button
                    onClick={() => setShowSetupRunner(true)}
                    className="btn-primary text-xs flex items-center gap-1.5 py-1.5 px-3"
                  >
                    <Server size={11} /> Set Up Runner
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Runs tab */}
          {tab === 'runs' && (
            <div className="space-y-2">
              {runsLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                  <Loader2 size={16} className="animate-spin" /> Loading runs…
                </div>
              )}
              {!runsLoading && (!runs || runs.length === 0) && (
                <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                  <Workflow size={28} className="opacity-20" />
                  <p className="text-sm opacity-50">No workflow runs found.</p>
                </div>
              )}
              {runs?.map(run => (
                <RunRow
                  key={run.id}
                  run={run}
                  owner={owner}
                  repo={repo}
                  onRerun={id => rerunMut.mutate(id)}
                />
              ))}
            </div>
          )}

          {/* Workflows tab */}
          {tab === 'workflows' && (
            <div className="space-y-2">
              {workflowsLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                  <Loader2 size={16} className="animate-spin" /> Detecting workflows…
                </div>
              )}
              {!workflowsLoading && (!workflows || workflows.length === 0) && (
                <WorkflowTemplate owner={owner} repo={repo} />
              )}
              {workflows?.map(w => (
                <div key={w} className="flex items-center gap-3 px-4 py-3 border border-border rounded-lg">
                  <Zap size={14} className="text-muted-foreground shrink-0" />
                  <span className="flex-1 text-sm font-medium text-foreground">{w}</span>
                  <button
                    onClick={() => { setShowTrigger(true) }}
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    <Play size={10} /> Trigger
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Runners tab */}
          {tab === 'runners' && (
            <div className="space-y-2">
              {runnersLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                  <Loader2 size={16} className="animate-spin" /> Loading runners…
                </div>
              )}
              {!runnersLoading && (!runners || runners.length === 0) && (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                  <Server size={28} className="opacity-20" />
                  <p className="text-sm opacity-50">No self-hosted runners registered.</p>
                  <button
                    onClick={() => setShowSetupRunner(true)}
                    className="btn-primary text-xs flex items-center gap-1.5 py-1.5 px-3"
                  >
                    <Server size={11} /> Set Up Runner
                  </button>
                </div>
              )}
              {runners?.map(runner => (
                <RunnerRow
                  key={runner.id}
                  runner={runner}
                  onDelete={id => deleteRunnerMut.mutate(id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {showTrigger && workflows && (
        <TriggerModal
          owner={owner}
          repo={repo}
          workflows={workflows}
          onClose={() => setShowTrigger(false)}
        />
      )}
      {showSetupRunner && (
        <SetupRunnerModal
          owner={owner}
          repo={repo}
          onClose={() => setShowSetupRunner(false)}
        />
      )}
    </div>
  )
}

// ── Runner row ────────────────────────────────────────────────────────────────

function RunnerRow({ runner, onDelete }: { runner: Runner; onDelete: (id: number) => void }) {
  const online = runner.status === 'online'
  return (
    <div className="flex items-center gap-3 px-4 py-3 border border-border rounded-lg group">
      <div className={`w-2 h-2 rounded-full shrink-0 ${online ? 'bg-green-400' : 'bg-muted-foreground'}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">{runner.name}</span>
          {runner.busy && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-400/20 text-blue-400 font-medium">busy</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {runner.labels.slice(0, 5).map(l => (
            <span key={l} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{l}</span>
          ))}
        </div>
      </div>
      <span className={`text-xs ${online ? 'text-green-400' : 'text-muted-foreground'}`}>
        {runner.status}
      </span>
      <button
        onClick={() => onDelete(runner.id)}
        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted transition-colors opacity-0 group-hover:opacity-100"
        title="Remove runner"
      >
        <Trash2 size={13} />
      </button>
    </div>
  )
}
