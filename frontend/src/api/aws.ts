import client from './client'
import type { AwsExplorerResponse } from '../types'

export interface Ec2Instance {
  instanceId: string
  name: string | null
  instanceType: string
  state: string
  publicIp: string | null
  privateIp: string | null
  launchTime: string | null
  platform: string | null
  region: string
}

export interface S3Bucket {
  name: string
  creationDate: string | null
}

export interface EcsCluster {
  clusterArn: string
  clusterName: string
  status: string
  activeServicesCount: number
  runningTasksCount: number
  region: string
}

export interface EcsService {
  serviceArn: string
  serviceName: string
  status: string
  desiredCount: number
  runningCount: number
  taskDefinition: string
}

export interface TraceItem {
  id: string
  duration: number | null
  responseTime: number | null
  hasFault: boolean
  hasError: boolean
  hasThrottle: boolean
  url?: string
  method?: string
  clientIp?: string
  serviceCount: number
}

export interface TopologyGraph {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
  region: string
}

export interface TopologyNode {
  id: string
  label: string
  service: string
  source: 'live' | 'terraform'
  [key: string]: unknown
}

export interface TopologyEdge {
  id: string
  source: string
  target: string
  label: string
}

const base = (accountId: number) => `/aws/accounts/${accountId}`

export const listEc2Instances = (accountId: number, region?: string) =>
  client.get<Ec2Instance[]>(`${base(accountId)}/ec2/instances`, { params: region ? { region } : {} }).then(r => r.data)

export const startInstance = (accountId: number, instanceId: string, region?: string) =>
  client.post(`${base(accountId)}/ec2/instances/${instanceId}/start`, null, { params: region ? { region } : {} })

export const stopInstance = (accountId: number, instanceId: string, region?: string) =>
  client.post(`${base(accountId)}/ec2/instances/${instanceId}/stop`, null, { params: region ? { region } : {} })

export const terminateInstance = (accountId: number, instanceId: string, region?: string) =>
  client.delete(`${base(accountId)}/ec2/instances/${instanceId}`, { params: region ? { region } : {} })

export const listS3Buckets = (accountId: number) =>
  client.get<S3Bucket[]>(`${base(accountId)}/s3/buckets`).then(r => r.data)

export const listEcsClusters = (accountId: number, region?: string) =>
  client.get<EcsCluster[]>(`${base(accountId)}/ecs/clusters`, { params: region ? { region } : {} }).then(r => r.data)

export const listEcsServices = (accountId: number, clusterArn: string, region?: string) =>
  client.get<EcsService[]>(`${base(accountId)}/ecs/clusters/${encodeURIComponent(clusterArn)}/services`, {
    params: region ? { region } : {},
  }).then(r => r.data)

export const getTopology = (accountId: number, region?: string) =>
  client.get<TopologyGraph>(`${base(accountId)}/topology`, { params: region ? { region } : {} }).then(r => r.data)

export const listTraces = (accountId: number, region?: string, minutes = 60) =>
  client.get<TraceItem[]>(`${base(accountId)}/traces`, { params: { ...(region ? { region } : {}), minutes } }).then(r => r.data)

export const getTrace = (accountId: number, traceId: string, region?: string) =>
  client.get<{ id: string; duration: number; segments: { id: string; document: string }[] }>(
    `${base(accountId)}/traces/${traceId}`, { params: region ? { region } : {} }
  ).then(r => r.data)

export const getExplorer = (accountId: number, region: string) =>
  client.get<AwsExplorerResponse>('/aws/explorer', { params: { accountId, region } })
    .then(r => r.data)

export const evictAwsCache = (accountId: number) =>
  client.post<void>(`/aws/accounts/${accountId}/cache/evict`)
    .then(r => r.data)
