import client from './client'

export interface TopologyNode {
  id: string
  type: 'machine' | 'deployment' | 'tunnel' | 'container'
  label: string
  status: string
  meta: Record<string, string>
}

export interface TopologyEdge {
  source: string
  target: string
  label: string
}

export interface TopologyGraph {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
}

export const getTopology = () =>
  client.get<TopologyGraph>('/topology').then((r) => r.data)
