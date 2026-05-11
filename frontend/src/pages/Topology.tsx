import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getTopology } from '../api/topology'
import {
  ReactFlow, Background, Controls, MiniMap, useNodesState, useEdgesState,
  type Node, type Edge, MarkerType
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from '@dagrejs/dagre'
import { Server, Rocket, Globe, Box, Loader2, Network } from 'lucide-react'

// ── Layout ────────────────────────────────────────────────────────────────────

const NODE_WIDTH = 180
const NODE_HEIGHT = 70

function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', ranksep: 80, nodesep: 40 })
  g.setDefaultEdgeLabel(() => ({}))
  nodes.forEach(n => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }))
  edges.forEach(e => g.setEdge(e.source, e.target))
  dagre.layout(g)
  return nodes.map(n => {
    const pos = g.node(n.id)
    return { ...n, position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 } }
  })
}

// ── Color / icon helpers ──────────────────────────────────────────────────────

function nodeColor(_type: string, status: string): string {
  if (status === 'ONLINE' || status === 'SUCCESS' || status === 'RUNNING' || status === 'ACTIVE') return 'oklch(0.78 0.16 155)'
  if (status === 'FAILED' || status === 'ERROR' || status === 'OFFLINE') return 'oklch(0.65 0.22 25)'
  if (['BUILDING', 'DEPLOYING', 'PENDING', 'STARTING'].includes(status)) return 'oklch(0.78 0.16 55)'
  return 'oklch(0.5 0 0)'
}

function nodeIcon(type: string) {
  if (type === 'machine') return Server
  if (type === 'deployment') return Rocket
  if (type === 'tunnel') return Globe
  return Box
}

// ── Custom node card ──────────────────────────────────────────────────────────

function TopologyNodeCard({ data }: { data: any }) {
  const Icon = nodeIcon(data.type)
  const color = nodeColor(data.type, data.status)
  return (
    <div style={{
      background: 'var(--color-card)',
      border: `1.5px solid ${color}33`,
      borderRadius: '10px',
      padding: '10px 14px',
      minWidth: 160,
      boxShadow: `0 0 0 1px ${color}22`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Icon size={14} style={{ color, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {data.label}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 10, color: 'var(--color-muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {data.type} · {data.status.toLowerCase()}
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
      borderRadius: 12, padding: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-foreground)' }}>{node.data.label}</span>
        <button onClick={onClose} style={{ color: 'var(--color-muted-foreground)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Object.entries(meta).map(([k, v]) => (
          <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</span>
            <span style={{ fontSize: 12, color: 'var(--color-foreground)', fontFamily: 'monospace', wordBreak: 'break-all' }}>{String(v)}</span>
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

  useEffect(() => {
    if (!data) return
    const rawNodes: Node[] = data.nodes.map(n => ({
      id: n.id,
      type: 'topology',
      position: { x: 0, y: 0 },
      data: { label: n.label, type: n.type, status: n.status, meta: n.meta },
    }))
    const rawEdges: Edge[] = data.edges.map((e, i) => ({
      id: `e-${i}`,
      source: e.source,
      target: e.target,
      label: e.label,
      animated: e.label === 'exposes',
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: 'var(--color-border)', strokeWidth: 1.5 },
      labelStyle: { fontSize: 10, fill: 'var(--color-muted-foreground)' },
      labelBgStyle: { fill: 'var(--color-card)' },
    }))
    setRfNodes(applyDagreLayout(rawNodes, rawEdges))
    setRfEdges(rawEdges)
  }, [data])

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
        fitView
        fitViewOptions={{ padding: 0.2 }}
      >
        <Background color="var(--color-border)" gap={20} size={1} />
        <Controls />
        <MiniMap nodeStrokeWidth={3} pannable zoomable />
      </ReactFlow>
      {selectedNode && <SidePanel node={selectedNode} onClose={() => setSelectedNode(null)} />}
    </div>
  )
}
