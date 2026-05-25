import client from './client'
import type { GitHubRepo, GitHubBranch } from '../types'

export interface GHUser { login: string; avatar_url: string }

export interface AriseConfig {
  compose?: string
  port?: number
  env?: string[]
  name?: string
  branch?: string
}

export const getAriseConfig = (owner: string, repo: string, branch: string) =>
  client.get<AriseConfig>(`/github/repos/${owner}/${repo}/arise-config`, { params: { branch } })
    .then(r => r.data)
    .catch(() => null)

export const saveGitHubToken = (token: string) =>
  client.post<{ message: string }>('/github/token', { token }).then((r) => r.data)
export const getGitHubUser = () =>
  client.get<GHUser>('/github/me').then((r) => r.data).catch(() => null)
export const getRepos = () => client.get<GitHubRepo[]>('/github/repos').then((r) => r.data)
export const getBranches = (owner: string, repo: string) =>
  client.get<GitHubBranch[]>(`/github/repos/${owner}/${repo}/branches`).then((r) => r.data)

export const getRepoReadme = (owner: string, repo: string) =>
  client.get<{content: string}>(`/github/repos/${owner}/${repo}/readme`).then(r => r.data)

export const getRepoTree = (owner: string, repo: string, branch: string) =>
  client.get<Array<{path: string; type: string; size?: number}>>(`/github/repos/${owner}/${repo}/tree`, { params: { branch } }).then(r => r.data)

export const getRepoEnvVars = (owner: string, repo: string, branch: string) =>
  client.get<{vars: string[]}>(`/github/repos/${owner}/${repo}/envvars`, { params: { branch } }).then(r => r.data)

export const getRunnerToken = (owner: string, repo: string) =>
  client.post<{token: string; expiresAt: string}>(`/github/repos/${owner}/${repo}/runner-token`).then(r => r.data)

export const getWorkflowRuns = (owner: string, repo: string) =>
  client.get<any[]>(`/cicd/runs/${owner}/${repo}`).then(r => r.data)

export const setupRunner = (owner: string, repo: string, machineId: number) =>
  client.post(`/cicd/runner/${owner}/${repo}/setup`, null, { params: { machineId } }).then(r => r.data)

export const getWorkflowFiles = (owner: string, repo: string) =>
  client.get<string[]>(`/cicd/workflows/${owner}/${repo}`).then(r => r.data)

export const getFileContent = (owner: string, repo: string, path: string, branch: string) =>
  client.get<{ content: string }>(`/github/repos/${owner}/${repo}/file`, { params: { path, branch } }).then(r => r.data)
