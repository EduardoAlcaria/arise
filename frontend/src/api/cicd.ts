import client from './client'

export interface WorkflowRun {
  id: number
  name: string
  status: string
  conclusion: string | null
  createdAt: string
  updatedAt: string
  headBranch: string
  event: string
}

export interface WorkflowJob {
  id: number
  name: string
  status: string
  conclusion: string | null
  startedAt: string | null
  completedAt: string | null
  htmlUrl: string
  steps?: { name: string; status: string; conclusion: string | null; number: number }[]
}

export interface Runner {
  id: number
  name: string
  status: string
  busy: boolean
  labels: string[]
  repo?: string
}

export const getWorkflows = (owner: string, repo: string) =>
  client.get<string[]>(`/cicd/workflows/${owner}/${repo}`).then(r => r.data)

export const getWorkflowRuns = (owner: string, repo: string) =>
  client.get<WorkflowRun[]>(`/cicd/runs/${owner}/${repo}`).then(r => r.data)

export const rerunWorkflow = (owner: string, repo: string, runId: number) =>
  client.post(`/cicd/runs/${owner}/${repo}/${runId}/rerun`)

export const triggerWorkflow = (owner: string, repo: string, workflowId: string, ref: string) =>
  client.post(`/cicd/workflows/${owner}/${repo}/${workflowId}/dispatch`, null, { params: { ref } })

export const getWorkflowJobs = (owner: string, repo: string, runId: number) =>
  client.get<WorkflowJob[]>(`/cicd/jobs/${owner}/${repo}/${runId}`).then(r => r.data)

export const listRunners = (owner: string, repo: string) =>
  client.get<Runner[]>(`/cicd/runners/${owner}/${repo}`).then(r => r.data)

export const deleteRunner = (owner: string, repo: string, runnerId: number) =>
  client.delete(`/cicd/runners/${owner}/${repo}/${runnerId}`)

export const triggerByPush = (owner: string, repo: string, ref: string) =>
  client.post(`/cicd/push/${owner}/${repo}`, null, { params: { ref } })

export const setupRunner = (owner: string, repo: string, machineId: number) =>
  client.post(`/cicd/runner/${owner}/${repo}/setup`, null, { params: { machineId } })

export const listAllRunners = () =>
  client.get<Runner[]>('/cicd/runners').then(r => r.data)
