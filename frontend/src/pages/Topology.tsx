import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getTopology } from '../api/topology'
import {
  ReactFlow, Background, BackgroundVariant, Controls, MiniMap, Panel,
  useNodesState, useEdgesState,
  type Node, type Edge, MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from '@dagrejs/dagre'
import { Server, Rocket, Globe, Box, Loader2, Network, Search, X } from 'lucide-react'

// ── Layout ────────────────────────────────────────────────────────────────────

const NODE_WIDTH = 200
const NODE_HEIGHT = 72

function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', ranksep: 100, nodesep: 50 })
  g.setDefaultEdgeLabel(() => ({}))
  nodes.forEach(n => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }))
  edges.forEach(e => g.setEdge(e.source, e.target))
  dagre.layout(g)
  return nodes.map(n => {
    const pos = g.node(n.id)
    return { ...n, position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 } }
  })
}

// ── Color helpers ─────────────────────────────────────────────────────────────

function nodeColor(status: string): string {
  if (['ONLINE', 'SUCCESS', 'RUNNING', 'ACTIVE'].includes(status)) return 'oklch(0.78 0.16 155)'
  if (['FAILED', 'ERROR', 'OFFLINE'].includes(status)) return 'oklch(0.65 0.22 25)'
  if (['BUILDING', 'DEPLOYING', 'PENDING', 'STARTING'].includes(status)) return 'oklch(0.78 0.16 55)'
  return 'oklch(0.45 0 0)'
}

function edgeColor(label: string): string {
  if (label === 'exposes') return 'oklch(0.78 0.16 155)'
  if (label === 'deployed on') return 'oklch(0.6 0.12 250)'
  if (label === 'hosts') return 'oklch(0.6 0.12 280)'
  return 'oklch(0.4 0 0)'
}

function nodeIcon(type: string) {
  if (type === 'machine') return Server
  if (type === 'deployment') return Rocket
  if (type === 'tunnel') return Globe
  return Box
}

// ── Custom node card ──────────────────────────────────────────────────────────

function TopologyNodeCard({ data, selected }: { data: any; selected?: boolean }) {
  const Icon = nodeIcon(data.type)
  const color = nodeColor(data.status)
  return (
    <div style={{
      background: 'var(--color-card)',
      border: `1.5px solid ${selected ? color : color + '55'}`,
      borderRadius: 10,
      padding: '10px 14px',
      minWidth: NODE_WIDTH - 20,
      boxShadow: selected
        ? `0 0 0 2px ${color}44, 0 4px 16px ${color}22`
        : `0 1px 4px rgba(0,0,0,0.2)`,
      opacity: data.dimmed ? 0.2 : 1,
      transition: 'opacity 0.2s, box-shadow 0.2s, border-color 0.2s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Icon size={14} style={{ color, flexShrink: 0 }} />
        <span style={{
          fontSize: 12, fontWeight: 600, color: 'var(--color-foreground)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {data.label}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <span style={{
          fontSize: 10, color: 'var(--color-muted-foreground)',
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          {data.type} · {data.status?.toLowerCase()}
        </span>
      </div>
    </div>
  )
}

const nodeTypes = { topology: TopologyNodeCard }

// ── Side panel ────────────────────────────────────────────────────────────────

function SidePanel({ node, onClose }: { node: any; onClose: () => void }) {
  const meta = node.data.meta ?? {}
  return (
    <div style={{
      position: 'absolute', top: 16, right: 16, width: 280, zIndex: 10,
      background: 'var(--color-card)', border: '1px solid var(--color-border)',
      borderRadius: 12, padding: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-foreground)' }}>{node.data.label}</span>
        <button onClick={onClose} style={{
          color: 'var(--color-muted-foreground)', background: 'none',
          border: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1,
        }}>✕</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Object.entries(meta).map(([k, v]) => (
          <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{
              fontSize: 10, fontWeight: 600, color: 'var(--color-muted-foreground)',
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>{k}</span>
            <span style={{
              fontSize: 12, color: 'var(--color-foreground)',
              fontFamily: 'monospace', wordBreak: 'break-all',
            }}>{String(v)}</span>
          </div>
        ))}
        {meta.tunnelUrl && (
          <a href={String(meta.tunnelUrl)} target="_blank" rel="noreferrer"
            style={{ fontSize: 12, color: 'var(--color-primary)', textDecoration: 'underline', marginTop: 4 }}>
            Open tunnel ↗
          </a>
        )}
        {meta.url && (
          <a href={String(meta.url)} target="_blank" rel="noreferrer"
            style={{ fontSize: 12, color: 'var(--color-primary)', textDecoration: 'underline', marginTop: 4 }}>
            Open ↗
          </a>
        )}
      </div>
    </div>
  )
}

// ── Type filter config ────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  machine: 'Machines',
  deployment: 'Deployments',
  tunnel: 'Tunnels',
  container: 'Containers',
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Topology() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['topology'],
    queryFn: getTopology,
    refetchInterval: 30_000,
  })

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([])
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [selectedNode, setSelectedNode] = useState<any>(null)
  const [search, setSearch] = useState('')
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set())

  const availableTypes = useMemo(
    () => (data ? [...new Set(data.nodes.map(n => n.type))] : []),
    [data],
  )

  useEffect(() => {
    if (!data) return

    const q = search.trim().toLowerCase()

    // IDs that directly match the search query
    const matchingIds = new Set(
      data.nodes
        .filter(n => !hiddenTypes.has(n.type))
        .filter(n => !q || n.label.toLowerCase().includes(q) || n.type.toLowerCase().includes(q))
        .map(n => n.id),
    )

    // When searching, also reveal direct neighbors of matching nodes
    const visibleIds = new Set(matchingIds)
    if (q) {
      data.edges.forEach(e => {
        if (matchingIds.has(e.source)) visibleIds.add(e.target)
        if (matchingIds.has(e.target)) visibleIds.add(e.source)
      })
    }

    const typeOf = new Map(data.nodes.map(n => [n.id, n.type]))

    const layoutNodes: Node[] = data.nodes
      .filter(n => !hiddenTypes.has(n.type))
      .map(n => ({
        id: n.id,
        type: 'topology',
        position: { x: 0, y: 0 },
        data: {
          label: n.label,
          type: n.type,
          status: n.status,
          meta: n.meta,
          dimmed: q ? !visibleIds.has(n.id) : false,
        },
      }))

    const layoutEdges: Edge[] = data.edges
      .filter(e =>
        !hiddenTypes.has(typeOf.get(e.source) ?? '') &&
        !hiddenTypes.has(typeOf.get(e.target) ?? ''),
      )
      .map((e, i) => {
        const color = edgeColor(e.label)
        const active = !q || (visibleIds.has(e.source) && visibleIds.has(e.target))
        return {
          id: `e-${i}`,
          source: e.source,
          target: e.target,
          label: e.label,
          type: 'smoothstep',
          animated: e.label === 'exposes',
          markerEnd: { type: MarkerType.ArrowClosed, color },
          style: { stroke: color, strokeWidth: 1.5, opacity: active ? 1 : 0.08 },
          labelStyle: { fontSize: 10, fill: 'var(--color-muted-foreground)' },
          labelBgStyle: { fill: 'var(--color-card)', fillOpacity: 0.9 },
          labelBgPadding: [4, 3] as [number, number],
          labelBgBorderRadius: 3,
        }
      })

    setRfNodes(applyDagreLayout(layoutNodes, layoutEdges))
    setRfEdges(layoutEdges)
  }, [data, search, hiddenTypes])

  function toggleType(type: string) {
    setHiddenTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  if (isLoading) return (
    <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
      <Loader2 size={18} className="animate-spin" /> Loading topology…
    </div>
  )

  if (error) return (
    <div className="flex items-center justify-center h-full text-destructive text-sm">
      Failed to load topology
    </div>
  )

  if (!data || data.nodes.length === 0) return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
      <Network size={40} className="opacity-20" />
      <p className="text-sm opacity-50">No infrastructure data yet. Add machines and deployments to see the topology.</p>
    </div>
  )

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => setSelectedNode(node)}
        onPaneClick={() => setSelectedNode(null)}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.1}
      >
        <Background variant={BackgroundVariant.Dots} color="var(--color-border)" gap={20} size={1.5} />
        <Controls />
        <MiniMap nodeStrokeWidth={3} pannable zoomable style={{ background: 'var(--color-card)' }} />

        <Panel position="top-left">
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 8,
            background: 'var(--color-card)', border: '1px solid var(--color-border)',
            borderRadius: 10, padding: '10px 12px', minWidth: 230,
            boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
          }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={13} style={{
                position: 'absolute', left: 8,
                color: 'var(--color-muted-foreground)', pointerEvents: 'none',
              }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search nodes…"
                style={{
                  width: '100%', padding: '5px 28px 5px 26px',
                  background: 'var(--color-background)', border: '1px solid var(--color-border)',
                  borderRadius: 6, fontSize: 12, color: 'var(--color-foreground)', outline: 'none',
                }}
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  style={{
                    position: 'absolute', right: 6, background: 'none', border: 'none',
                    cursor: 'pointer', color: 'var(--color-muted-foreground)',
                    display: 'flex', alignItems: 'center',
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {availableTypes.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {availableTypes.map(type => {
                  const active = !hiddenTypes.has(type)
                  const Icon = nodeIcon(type)
                  return (
                    <button
                      key={type}
                      onClick={() => toggleType(type)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '3px 8px', borderRadius: 20, fontSize: 11, fontWeight: 500,
                        border: '1px solid var(--color-border)',
                        background: active ? 'var(--color-primary)' : 'transparent',
                        color: active ? 'var(--color-primary-foreground)' : 'var(--color-muted-foreground)',
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}
                    >
                      <Icon size={10} />
                      {TYPE_LABELS[type] ?? type}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </Panel>
      </ReactFlow>

      {selectedNode && <SidePanel node={selectedNode} onClose={() => setSelectedNode(null)} />}
    </div>
  )
}
