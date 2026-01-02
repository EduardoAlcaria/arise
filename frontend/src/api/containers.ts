import client from './client'
import type { ContainerDeployment } from '../types'

export interface ContainerDeployRequest {
  name: string
  image: string
  hostPort?: number
  containerPort?: number
  envVars?: Record<string, string>
  machineId: number
}

export const getContainers = () => client.get<ContainerDeployment[]>('/containers').then((r) => r.data)
export const getContainer = (id: number) => client.get<ContainerDeployment>(`/containers/${id}`).then((r) => r.data)
export const deployContainer = (data: ContainerDeployRequest) => client.post<ContainerDeployment>('/containers', data).then((r) => r.data)
export const stopContainer = (id: number) => client.post<ContainerDeployment>(`/containers/${id}/stop`).then((r) => r.data)
export const restartContainer = (id: number) => client.post<ContainerDeployment>(`/containers/${id}/restart`).then((r) => r.data)
export const removeContainer = (id: number) => client.delete(`/containers/${id}`)
export const getContainerLogs = (id: number) => client.get<{ logs: string }>(`/containers/${id}/logs`).then((r) => r.data)
