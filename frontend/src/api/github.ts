import client from './client'
import type { GitHubRepo, GitHubBranch } from '../types'

export interface GHUser { login: string; avatar_url: string }

export const saveGitHubToken = (token: string) =>
  client.post<{ message: string }>('/github/token', { token }).then((r) => r.data)
export const getGitHubUser = () =>
  client.get<GHUser>('/github/me').then((r) => r.data).catch(() => null)
export const getRepos = () => client.get<GitHubRepo[]>('/github/repos').then((r) => r.data)
export const getBranches = (owner: string, repo: string) =>
  client.get<GitHubBranch[]>(`/github/repos/${owner}/${repo}/branches`).then((r) => r.data)
