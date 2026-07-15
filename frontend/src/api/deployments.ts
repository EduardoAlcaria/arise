import client from './client'
import { useAuthStore } from '../stores/authStore'
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
  webhookUrl?: string
  infisicalEnvironment?: string
  infisicalSecretPath?: string
}

export const getDeployments = (page = 0, size = 20) =>
  client.get<Page<Deployment>>('/deployments', { params: { page, size, sort: 'createdAt,desc' } }).then((r) => r.data)
export const getDeployment = (id: number) => client.get<Deployment>(`/deployments/${id}`).then((r) => r.data)
export const createDeployment = (data: DeploymentRequest) => client.post<Deployment>('/deployments', data).then((r) => r.data)
export const rollbackDeployment = (id: number) => client.post<Deployment>(`/deployments/${id}/rollback`).then((r) => r.data)
export const redeployDeployment = (id: number) =>
  client.post<Deployment>(`/deployments/${id}/redeploy`).then((r) => r.data)
export const getDeploymentLogs = (id: number) => client.get<LogEntry[]>(`/deployments/${id}/logs`).then((r) => r.data)
export const addDeploymentTunnel = (id: number, tunnelName: string, tunnelHostname: string, tunnelAppPort: number) =>
  client.post<Deployment>(`/deployments/${id}/tunnel`, { tunnelName, tunnelHostname, tunnelAppPort }).then((r) => r.data)
export const deleteDeployment = (id: number) => client.delete(`/deployments/${id}`)
export const removeDeploymentTunnel = (id: number) =>
  client.delete<Deployment>(`/deployments/${id}/tunnel`).then((r) => r.data)

export function streamDeploymentLogs(
  id: number,
  onMessage: (line: string) => void,
  onComplete: () => void,
  onError: (err: Error) => void,
): () => void {
  const token = useAuthStore.getState().token
  const controller = new AbortController()

  fetch(`/api/deployments/${id}/logs/stream`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) { onError(new Error(`HTTP ${res.status}`)); return }
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) { onComplete(); break }
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n')
        buffer = parts.pop()!
        for (const part of parts) {
          if (part.startsWith('data: ')) onMessage(part.slice(6))
        }
      }
    })
    .catch((err) => {
      if ((err as Error).name !== 'AbortError') onError(err as Error)
    })

  return () => controller.abort()
}
