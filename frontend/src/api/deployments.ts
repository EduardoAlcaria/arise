import client from './client'
import type { Deployment, LogEntry, Page } from '../types'

export interface AppServiceItem {
  name: string
  repoUrl: string
  branch: string
}

export interface ConfigFileItem {
  path: string
  content: string
}

export interface DeploymentRequest {
  name: string
  type: 'REPOSITORY' | 'CONTAINER' | 'APPLICATION'
  repositoryUrl?: string
  branch?: string
  version?: string
  machineId: number
  services?: AppServiceItem[]
  configFiles?: ConfigFileItem[]
  tunnelName?: string
  tunnelHostname?: string
  tunnelAppPort?: number
}

export const getDeployments = (page = 0, size = 20) =>
  client.get<Page<Deployment>>('/deployments', { params: { page, size, sort: 'createdAt,desc' } }).then((r) => r.data)
export const getDeployment = (id: number) => client.get<Deployment>(`/deployments/${id}`).then((r) => r.data)
export const createDeployment = (data: DeploymentRequest) => client.post<Deployment>('/deployments', data).then((r) => r.data)
export const rollbackDeployment = (id: number) => client.post<Deployment>(`/deployments/${id}/rollback`).then((r) => r.data)
export const getDeploymentLogs = (id: number) => client.get<LogEntry[]>(`/deployments/${id}/logs`).then((r) => r.data)
export const addDeploymentTunnel = (id: number, tunnelName: string, tunnelHostname: string, tunnelAppPort: number) =>
  client.post<Deployment>(`/deployments/${id}/tunnel`, { tunnelName, tunnelHostname, tunnelAppPort }).then((r) => r.data)
