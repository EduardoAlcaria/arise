export interface AuthResponse {
  token: string
  email: string
  name: string
  role: string
}

export interface Machine {
  id: number
  name: string
  host: string
  port: number
  sshUser: string
  status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN' | 'ERROR'
  lastSeen: string | null
  createdAt: string
  ownerId: number
}

export interface ContainerDeployment {
  id: number
  name: string
  image: string
  hostPort: number | null
  containerPort: number | null
  envVars: Record<string, string>
  containerId: string | null
  status: 'PENDING' | 'PULLING' | 'RUNNING' | 'STOPPED' | 'FAILED' | 'REMOVED'
  machineId: number
  machineName: string
  ownerId: number
  createdAt: string
  updatedAt: string
}

export interface Deployment {
  id: number
  name: string
  type: 'REPOSITORY' | 'CONTAINER' | 'APPLICATION'
  status: 'PENDING' | 'BUILDING' | 'DEPLOYING' | 'SUCCESS' | 'FAILED' | 'ROLLED_BACK'
  repositoryUrl: string | null
  branch: string | null
  logs: string | null
  version: string | null
  detectedStack: string | null
  applicationServices: string | null
  applicationConfigs: string | null
  tunnelName: string | null
  tunnelHostname: string | null
  cloudfareTunnelId: string | null
  cloudfareTunnelUrl: string | null
  machineId: number | null
  machineName: string | null
  ownerId: number
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}

export interface LogEntry {
  id: number
  message: string
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'
  createdAt: string
}

export interface GitHubRepo {
  name: string
  fullName: string
  description: string | null
  url: string
  private: boolean
  defaultBranch: string
  language: string | null
  stargazersCount: number
  updatedAt: string | null
}

export interface GitHubBranch {
  name: string
  sha: string
}

export interface CloudflareZone {
  id: string
  name: string
  status: string
  accountId: string
}

export interface CloudflareTunnel {
  id: string
  name: string
  status: string
  accountId: string
}

export interface Page<T> {
  content: T[]
  totalElements: number
  totalPages: number
  number: number
  size: number
}

export interface ApiError {
  status: number
  message: string
  timestamp: string
}
