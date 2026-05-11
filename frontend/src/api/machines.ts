import client from './client'
import type { Machine } from '../types'

export interface MachineRequest {
  name: string
  host: string
  port: number
  sshUser: string
  privateKey: string
  proxyCommand?: string
}

export const getMachines = () => client.get<Machine[]>('/machines').then((r) => r.data)
export const getMachine = (id: number) => client.get<Machine>(`/machines/${id}`).then((r) => r.data)
export const createMachine = (data: MachineRequest) => client.post<Machine>('/machines', data).then((r) => r.data)
export const updateMachine = (id: number, data: MachineRequest) => client.put<Machine>(`/machines/${id}`, data).then((r) => r.data)
export const deleteMachine = (id: number) => client.delete(`/machines/${id}`)
export const testMachine = (id: number) => client.post<{ online: boolean }>(`/machines/${id}/test`).then((r) => r.data)
export const execOnMachine = (id: number, command: string) =>
  client.post<{ stdout: string; stderr: string; exitCode: number }>(`/machines/${id}/exec`, { command }).then((r) => r.data)
