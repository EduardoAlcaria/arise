import client from './client'
import type { CloudflareZone, CloudflareTunnel } from '../types'

export const saveCloudflareToken = (token: string, accountId: string) =>
  client.post<{ message: string }>('/cloudflare/token', { token, accountId }).then((r) => r.data)
export const getCloudflareStatus = () =>
  client.get<{ configured: boolean }>('/cloudflare/status').then((r) => r.data)
export const getZones = () => client.get<CloudflareZone[]>('/cloudflare/zones').then((r) => r.data)
export const createTunnel = (name: string, tunnelSecret: string) =>
  client.post<CloudflareTunnel>('/cloudflare/tunnels', { name, tunnelSecret }).then((r) => r.data)
export const getTunnels = () => client.get<CloudflareTunnel[]>('/cloudflare/tunnels').then((r) => r.data)
