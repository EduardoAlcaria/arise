import client from './client'

export interface AwsAccountResponse {
  id: number
  name: string
  profileName: string
  defaultRegion: string
  terraformRepoUrl: string | null
  createdAt: string
  reachable: boolean
  accountId: string | null
}

export interface AwsAccountRequest {
  name: string
  profileName: string
  region: string
  terraformRepoUrl?: string
}

export const listAwsAccounts = () =>
  client.get<AwsAccountResponse[]>('/aws/accounts').then(r => r.data)

export const createAwsAccount = (req: AwsAccountRequest) =>
  client.post<AwsAccountResponse>('/aws/accounts', req).then(r => r.data)

export const updateAwsAccount = (id: number, req: AwsAccountRequest) =>
  client.put<AwsAccountResponse>(`/aws/accounts/${id}`, req).then(r => r.data)

export const ssoLogin = (id: number) =>
  client.post<{ url: string; code: string; profile: string }>(`/aws/accounts/${id}/sso-login`).then(r => r.data)

export const deleteAwsAccount = (id: number) =>
  client.delete(`/aws/accounts/${id}`)
