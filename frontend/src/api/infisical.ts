import client from './client'

export interface InfisicalSecret { secretName: string; secretValue: string }

export const connectInfisical = (data: { clientId: string; clientSecret: string; baseUrl?: string; projectId?: string }) =>
  client.post<{connected: boolean; user?: string}>('/infisical/connect', data).then(r => r.data)

export const getInfisicalStatus = () =>
  client.get<{connected: boolean; projectId?: string; baseUrl?: string}>('/infisical/status').then(r => r.data)

export const getInfisicalSecrets = (environment: string, secretPath = '/') =>
  client.get<InfisicalSecret[]>('/infisical/secrets', { params: { environment, secretPath } }).then(r => r.data)
