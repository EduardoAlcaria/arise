import ReactMarkdown from 'react-markdown'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createDeployment } from '../api/deployments'
import { getRepos, getBranches, getRepoReadme, getRepoTree, getFileContent } from '../api/github'
import { getMachines } from '../api/machines'
import { Search, Star, GitBranch, Lock, Unlock, X, ChevronDown, ChevronRight, Rocket, Link2Off, FileText, Folder } from 'lucide-react'
import { GitHubIcon } from '../components/icons'
import DeployRepoWizard, { type DeployItem, type AppDeployPayload } from '../components/DeployRepoWizard'
import DeploymentWatcher from '../components/DeploymentWatcher'
import type { GitHubRepo, GitHubBranch } from '../types'

interface GHUser { login: string; avatar_url: string }

const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178C6', JavaScript: '#F7DF1E', Python: '#3572A5',
  Java: '#B07219', Go: '#00ADD8', Rust: '#DEA584', 'C#': '#178600',
  PHP: '#4F5D95', Ruby: '#701516', Kotlin: '#A97BFF', Swift: '#F05138',
}


function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

interface TreeNode {
  path: string
  type: string
  size?: number
  children?: TreeNode[]
  name: string
}

function buildTree(items: Array<{path: string; type: string; size?: number}>): TreeNode[] {
  const root: TreeNode[] = []
  for (const item of items) {
    const parts = item.path.split('/')
    let current = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      let existing = current.find(n => n.name === part)
      if (!existing) {
        existing = {
          path: parts.slice(0, i + 1).join('/'),
          type: isLast ? item.type : 'tree',
          size: isLast ? item.size : undefined,
          name: part,
          children: isLast && item.type !== 'tree' ? undefined : [],
        }
        current.push(existing)
      }
      if (!isLast) {
        current = existing.children ?? []
      }
    }
  }
  // Sort: folders first, then files
  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) => {
      if (a.type === 'tree' && b.type !== 'tree') return -1
      if (a.type !== 'tree' && b.type === 'tree') return 1
      return a.name.localeCompare(b.name)
    })
    for (const node of nodes) {
      if (node.children) sortNodes(node.children)
    }
    return nodes
  }
  return sortNodes(root)
}

function TreeItem({
  node, depth = 0, onFileClick,
}: {
  node: TreeNode; depth?: number; onFileClick?: (path: string) => void
}) {
  const [open, setOpen] = useState(depth < 1)
  const isDir = node.type === 'tree'
  return (
    <div>
      <button
        onClick={() => {
          if (isDir) setOpen(v => !v)
          else onFileClick?.(node.path)
        }}
        className={`w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs transition-colors ${
          isDir
            ? 'hover:bg-muted/40 cursor-pointer'
            : 'hover:bg-muted/30 cursor-pointer text-muted-foreground'
        }`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        {isDir ? (
          <>
            {open ? <ChevronDown size={12} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={12} className="shrink-0 text-muted-foreground" />}
            <Folder size={13} className="shrink-0 text-muted-foreground" />
          </>
        ) : (
          <>
            <span className="w-3 shrink-0" />
            <FileText size={12} className="shrink-0 text-muted-foreground" />
          </>
        )}
        <span className={isDir ? 'text-foreground font-medium' : 'text-muted-foreground'}>{node.name}</span>
      </button>
      {isDir && open && node.children && (
        <div>
          {node.children.map(child => (
            <TreeItem key={child.path} node={child} depth={depth + 1} onFileClick={onFileClick} />
          ))}
        </div>
      )}
    </div>
  )
}

interface RepoPanelProps {
  repo: GitHubRepo
  onClose: () => void
  onDeploy: (repo: GitHubRepo, branch: string) => void
}

function RepoPanel({ repo, onClose, onDeploy }: RepoPanelProps) {
  const [tab, setTab] = useState<'readme' | 'files'>('readme')
  const [branch, setBranch] = useState(repo.defaultBranch)
  const [branches, setBranches] = useState<GitHubBranch[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  const [owner, repoName] = repo.fullName.split('/')

  useEffect(() => {
    getBranches(owner, repoName).then(b => setBranches(b)).catch(() => {})
  }, [owner, repoName])

  const { data: readmeData, isPending: readmePending } = useQuery({
    queryKey: ['repo-readme', repo.fullName],
    queryFn: () => getRepoReadme(owner, repoName),
    retry: false,
  })

  const { data: treeData, isPending: treePending } = useQuery({
    queryKey: ['repo-tree', repo.fullName, branch],
    queryFn: () => getRepoTree(owner, repoName, branch),
    enabled: tab === 'files',
    retry: false,
  })

  const { data: fileData, isPending: filePending } = useQuery({
    queryKey: ['repo-file', repo.fullName, branch, selectedFile],
    queryFn: () => getFileContent(owner, repoName, selectedFile!, branch),
    enabled: selectedFile !== null,
    retry: false,
  })

  const treeNodes = treeData ? buildTree(treeData) : []
  const langColor = repo.language ? (LANG_COLORS[repo.language] ?? '#888') : '#888'

  return (
    <>
      {/* Backdrop for mobile */}
      <div className="fixed inset-0 bg-black/40 z-30 md:hidden" onClick={onClose} />

      <div className="fixed right-0 top-0 bottom-0 z-40 flex flex-col bg-card border-l border-border shadow-2xl animate-fade-up"
        style={{ width: 'min(50vw, 640px)', minWidth: '320px' }}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-semibold text-foreground text-base truncate">{repo.name}</h2>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${repo.private ? 'bg-amber-400/10 text-amber-400' : 'bg-muted text-muted-foreground'}`}>
                  {repo.private ? <><Lock size={9} className="inline mr-1" />Private</> : <><Unlock size={9} className="inline mr-1" />Public</>}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{repo.fullName}</p>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors shrink-0 p-0.5">
              <X size={18} />
            </button>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {repo.language && (
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: langColor }} />
                {repo.language}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Star size={11} />
              {repo.stargazersCount}
            </span>
            <span className="flex items-center gap-1">
              <GitBranch size={11} />
              {repo.defaultBranch}
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-5 py-2 border-b border-border shrink-0">
          {(['readme', 'files'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-3 py-1.5 rounded-md text-xs font-semibold transition-all capitalize"
              style={{
                background: tab === t ? 'var(--color-muted)' : 'transparent',
                color: tab === t ? 'var(--color-foreground)' : 'var(--color-muted-foreground)',
              }}
            >
              {t === 'readme' ? 'README' : 'Files'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === 'readme' && (
            readmePending ? (
              <div className="space-y-2 animate-pulse">
                {[80, 60, 90, 50, 70].map((w, i) => (
                  <div key={i} className="h-3 rounded bg-muted" style={{ width: `${w}%` }} />
                ))}
              </div>
            ) : readmeData?.content ? (
              <div className="prose prose-sm prose-invert text-sm text-foreground leading-relaxed" style={{ maxWidth: '100%' }}>
                <ReactMarkdown
                  components={{
                    a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:opacity-80">{children}</a>,
                    code: ({ children, className }) => className
                      ? <pre className="bg-muted rounded p-3 overflow-x-auto my-2"><code>{children}</code></pre>
                      : <code className="bg-muted rounded px-1 text-[0.85em]">{children}</code>,
                    h1: ({ children }) => <h1 className="text-xl font-bold mt-5 mb-3 border-b border-border pb-2">{children}</h1>,
                    h2: ({ children }) => <h2 className="text-lg font-bold mt-5 mb-2 border-b border-border pb-1">{children}</h2>,
                    h3: ({ children }) => <h3 className="text-base font-semibold mt-4 mb-1">{children}</h3>,
                    h4: ({ children }) => <h4 className="text-sm font-semibold mt-3 mb-1">{children}</h4>,
                    blockquote: ({ children }) => <blockquote className="border-l-4 border-muted-foreground/30 pl-3 italic text-muted-foreground my-2">{children}</blockquote>,
                    ul: ({ children }) => <ul className="my-2 space-y-0.5 list-disc ml-4">{children}</ul>,
                    ol: ({ children }) => <ol className="my-2 space-y-0.5 list-decimal ml-4">{children}</ol>,
                    hr: () => <hr className="border-border my-4" />,
                    img: ({ src, alt }) => <img src={src} alt={alt} className="max-w-full rounded my-2" />,
                    p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
                  }}
                >
                  {readmeData.content}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                <FileText size={28} className="opacity-30" />
                <p className="text-xs opacity-50">No README found</p>
              </div>
            )
          )}

          {tab === 'files' && (
            selectedFile ? (
              <div className="flex flex-col h-full min-h-0">
                <div className="flex items-center gap-2 mb-3">
                  <button
                    onClick={() => setSelectedFile(null)}
                    className="text-xs text-primary hover:underline"
                  >
                    ← Files
                  </button>
                  <span className="text-xs text-muted-foreground font-mono truncate">{selectedFile}</span>
                </div>
                {filePending ? (
                  <div className="space-y-1 animate-pulse">
                    {Array.from({ length: 10 }).map((_, i) => (
                      <div key={i} className="h-4 rounded bg-muted" style={{ width: `${50 + (i % 5) * 10}%` }} />
                    ))}
                  </div>
                ) : (
                  <pre
                    className="flex-1 overflow-auto font-mono text-[12px] leading-relaxed text-foreground bg-muted/20 rounded-lg p-3 whitespace-pre-wrap break-all"
                  >
                    {fileData?.content || '(empty file)'}
                  </pre>
                )}
              </div>
            ) : (
              treePending ? (
                <div className="space-y-1 animate-pulse">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="h-7 rounded bg-muted" style={{ width: `${60 + (i % 3) * 15}%`, marginLeft: `${(i % 2) * 16}px` }} />
                  ))}
                </div>
              ) : treeNodes.length ? (
                <div className="font-mono text-[13px]">
                  {treeNodes.map(node => <TreeItem key={node.path} node={node} onFileClick={setSelectedFile} />)}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                  <Folder size={28} className="opacity-30" />
                  <p className="text-xs opacity-50">Empty repository</p>
                </div>
              )
            )
          )}
        </div>

        {/* Sticky deploy bar */}
        <div className="px-5 py-3.5 border-t border-border flex items-center gap-3 shrink-0 bg-card">
          <span className="text-xs text-muted-foreground shrink-0">Deploy branch:</span>
          <select
            className="input-field mono text-xs flex-1"
            style={{ paddingTop: '5px', paddingBottom: '5px', height: '32px' }}
            value={branch}
            onChange={e => setBranch(e.target.value)}
          >
            {branches.length ? (
              branches.map(b => <option key={b.name} value={b.name}>{b.name}</option>)
            ) : (
              <option value={repo.defaultBranch}>{repo.defaultBranch}</option>
            )}
          </select>
          <button
            onClick={() => onDeploy(repo, branch)}
            className="flex items-center gap-2 px-4 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:opacity-90 transition-all shrink-0"
          >
            <Rocket size={12} /> Deploy
          </button>
        </div>
      </div>
    </>
  )
}

export default function GitHub() {
  const [ghUser, setGhUser] = useState<GHUser | null>(() => {
    try { return JSON.parse(localStorage.getItem('gh_user') ?? 'null') } catch { return null }
  })
  const [showWizard, setShowWizard] = useState(false)
  const [search, setSearch] = useState('')
  const [langFilter, setLangFilter] = useState('')
  const [visFilter, setVisFilter] = useState<'all' | 'public' | 'private'>('all')
  const [sortBy, setSortBy] = useState<'pushed' | 'updated' | 'name'>('pushed')
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null)
  const [watching, setWatching] = useState<{ id: number; name: string } | null>(null)
  const [wizardInitialRepo, setWizardInitialRepo] = useState<{ repo: GitHubRepo; branch: string } | null>(null)

  const { data: repos, isError: noToken, isPending: checkingToken } = useQuery({
    queryKey: ['github-repos'],
    queryFn: getRepos,
    retry: false,
    staleTime: 60_000,
  })
  const isConnected = !noToken && !checkingToken && repos !== undefined

  const qc = useQueryClient()
  const { data: machines } = useQuery({ queryKey: ['machines'], queryFn: getMachines })
  const deployMut = useMutation({ mutationFn: createDeployment })

  const languages = repos
    ? [...new Set(repos.map(r => r.language).filter(Boolean) as string[])].sort()
    : []

  const filtered = (repos ?? [])
    .filter(r => {
      if (visFilter === 'public' && r.private) return false
      if (visFilter === 'private' && !r.private) return false
      if (langFilter && r.language !== langFilter) return false
      if (search) {
        const q = search.toLowerCase()
        return r.name.toLowerCase().includes(q) ||
          (r.description ?? '').toLowerCase().includes(q) ||
          (r.language ?? '').toLowerCase().includes(q)
      }
      return true
    })
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      if (sortBy === 'updated') {
        return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
      }
      // 'pushed' — most recently pushed first
      return (b.pushedAt ?? b.updatedAt ?? '').localeCompare(a.pushedAt ?? a.updatedAt ?? '')
    })

  const handlePatValidated = (user: GHUser) => {
    setGhUser(user)
    localStorage.setItem('gh_user', JSON.stringify(user))
    qc.invalidateQueries({ queryKey: ['github-repos'] })
  }

  const handleDeploy = async (items: DeployItem[]) => {
    let first = null
    for (const item of items) {
      const dep = await deployMut.mutateAsync({
        name: item.name,
        type: 'REPOSITORY',
        repositoryUrl: item.repoUrl,
        branch: item.branch,
        machineId: item.machineId,
        tunnelName: item.tunnelName,
        tunnelHostname: item.tunnelHostname,
        tunnelAppPort: item.tunnelAppPort,
      })
      if (!first) first = dep
    }
    qc.invalidateQueries({ queryKey: ['deployments-repo'] })
    qc.invalidateQueries({ queryKey: ['deployments', 0] })
    setShowWizard(false)
    setWizardInitialRepo(null)
    if (first) setWatching({ id: first.id, name: first.name })
  }

  const handleAppDeploy = async (payload: AppDeployPayload) => {
    const dep = await deployMut.mutateAsync({
      name: payload.name,
      type: 'APPLICATION',
      machineId: payload.machineId,
      services: payload.services,
      configFiles: payload.configFiles,
      tunnelName: payload.tunnelName,
      tunnelHostname: payload.tunnelHostname,
      tunnelAppPort: payload.tunnelAppPort,
    })
    qc.invalidateQueries({ queryKey: ['deployments-repo'] })
    qc.invalidateQueries({ queryKey: ['deployments', 0] })
    setShowWizard(false)
    setWizardInitialRepo(null)
    setWatching({ id: dep.id, name: dep.name })
  }

  const openDeployForRepo = (repo: GitHubRepo, branch: string) => {
    setSelectedRepo(null)
    setWizardInitialRepo({ repo, branch })
    setShowWizard(true)
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Connection banner */}
      {checkingToken ? (
        <div className="flex items-center gap-3 mb-5 px-4 py-3 bg-card border border-border rounded-xl animate-pulse h-[52px]" />
      ) : isConnected ? (
        <div className="flex items-center gap-3 mb-5 px-4 py-3 bg-card border border-border rounded-xl animate-fade-up">
          {ghUser ? (
            <>
              <img src={ghUser.avatar_url} alt="" className="w-7 h-7 rounded-full" />
              <div>
                <p className="text-sm font-semibold text-foreground">{ghUser.login}</p>
                <p className="text-[11px]" style={{ color: 'oklch(0.78 0.16 155)' }}>Token saved · connected to GitHub</p>
              </div>
            </>
          ) : (
            <>
              <GitHubIcon size={20} className="text-foreground" />
              <div>
                <p className="text-sm font-semibold text-foreground">Connected to GitHub</p>
                <p className="text-[11px]" style={{ color: 'oklch(0.78 0.16 155)' }}>Token saved in database</p>
              </div>
            </>
          )}
          <button
            onClick={() => { setWizardInitialRepo(null); setShowWizard(true) }}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md hover:bg-muted font-medium"
          >
            Update token
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3 mb-5 px-4 py-3 bg-card border border-dashed border-border rounded-xl animate-fade-up">
          <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center">
            <Link2Off size={13} className="text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No GitHub token configured</p>
          <button onClick={() => { setWizardInitialRepo(null); setShowWizard(true) }}
            className="ml-auto text-xs font-semibold text-foreground underline underline-offset-2 hover:opacity-80 transition-opacity">
            Connect →
          </button>
        </div>
      )}

      {/* Search + filters */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            className="input-field w-full"
            placeholder="Search repositories…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: '36px' }}
          />
        </div>
        {languages.length > 0 && (
          <select
            value={langFilter}
            onChange={e => setLangFilter(e.target.value)}
            className="input-field"
            style={{ width: 'auto', minWidth: '120px' }}
          >
            <option value="">All languages</option>
            {languages.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
        <div className="flex rounded-lg border border-border overflow-hidden text-xs font-medium">
          {(['all', 'public', 'private'] as const).map(v => (
            <button
              key={v}
              onClick={() => setVisFilter(v)}
              className="px-3 py-2 capitalize transition-colors"
              style={{
                background: visFilter === v ? 'var(--color-muted)' : 'transparent',
                color: visFilter === v ? 'var(--color-foreground)' : 'var(--color-muted-foreground)',
              }}
            >
              {v}
            </button>
          ))}
        </div>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as 'pushed' | 'updated' | 'name')}
          className="input-field"
          style={{ width: 'auto', minWidth: '150px' }}
        >
          <option value="pushed">Recently pushed</option>
          <option value="updated">Recently updated</option>
          <option value="name">Name A–Z</option>
        </select>
      </div>

      {/* Repo grid */}
      {checkingToken ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-xl h-36 animate-pulse" />
          ))}
        </div>
      ) : !isConnected ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <GitHubIcon size={36} className="opacity-20" />
          <p className="text-sm opacity-50">Connect your GitHub account to browse repositories.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <GitHubIcon size={36} className="opacity-20" />
          <p className="text-sm opacity-50">
            {repos && repos.length > 0 ? 'No repositories match your search.' : 'No repositories found.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(repo => {
            const langColor = repo.language ? (LANG_COLORS[repo.language] ?? '#888') : null
            return (
              <button
                key={repo.fullName}
                onClick={() => setSelectedRepo(repo)}
                className="bg-card border border-border rounded-xl p-4 text-left transition-all hover:border-border/80 card-hover flex flex-col gap-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-foreground text-sm truncate flex-1">{repo.name}</p>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${repo.private ? 'bg-amber-400/10 text-amber-400' : 'bg-muted text-muted-foreground'}`}>
                    {repo.private ? 'Private' : 'Public'}
                  </span>
                </div>

                {repo.description && (
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{repo.description}</p>
                )}

                <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-auto pt-1 flex-wrap">
                  {repo.language && langColor && (
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: langColor }} />
                      {repo.language}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Star size={11} />
                    {repo.stargazersCount}
                  </span>
                  <span className="flex items-center gap-1 ml-auto">
                    <GitBranch size={11} />
                    {repo.defaultBranch}
                  </span>
                </div>

                {(repo.pushedAt ?? repo.updatedAt) && (
                  <p className="text-[10px] text-muted-foreground/60">
                    {repo.pushedAt ? 'Pushed' : 'Updated'} {timeAgo(repo.pushedAt ?? repo.updatedAt)}
                  </p>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Right panel */}
      {selectedRepo && (
        <RepoPanel
          repo={selectedRepo}
          onClose={() => setSelectedRepo(null)}
          onDeploy={openDeployForRepo}
        />
      )}

      {/* Deploy wizard */}
      {showWizard && (
        <DeployRepoWizard
          isConnected={isConnected}
          initialUser={ghUser}
          machines={machines ?? []}
          initialRepoForDeploy={wizardInitialRepo ?? undefined}
          onCancel={() => { setShowWizard(false); setWizardInitialRepo(null) }}
          onDeploy={handleDeploy}
          onAppDeploy={handleAppDeploy}
          isDeploying={deployMut.isPending}
          onPatValidated={handlePatValidated}
        />
      )}

      {watching && (
        <DeploymentWatcher
          deploymentId={watching.id}
          deploymentName={watching.name}
          onClose={() => { setWatching(null); qc.invalidateQueries({ queryKey: ['deployments-repo'] }) }}
        />
      )}
    </div>
  )
}
