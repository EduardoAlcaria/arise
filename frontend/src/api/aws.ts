import client from './client'

export interface Ec2Instance {
  instanceId: string
  name: string | null
  instanceType: string
  state: string
  publicIp: string | null
  privateIp: string | null
  launchTime: string | null
  platform: string | null
  region: string
}

export interface S3Bucket {
  name: string
  creationDate: string | null
}

export interface EcsCluster {
  clusterArn: string
  clusterName: string
  status: string
  activeServicesCount: number
  runningTasksCount: number
  region: string
}

export interface EcsService {
  serviceArn: string
  serviceName: string
  status: string
  desiredCount: number
  runningCount: number
  taskDefinition: string
}

export interface AwsStatus {
  configured: boolean
  region?: string
  accountId?: string
  userArn?: string
  error?: string
}

export const saveAwsCredentials = (accessKeyId: string, secretAccessKey: string, region: string) =>
  client.post<{ accountId: string; userArn: string; region: string }>('/aws/credentials', {
    accessKeyId, secretAccessKey, region,
  }).then(r => r.data)

export const getAwsStatus = () =>
  client.get<AwsStatus>('/aws/status').then(r => r.data)

export const listEc2Instances = (region?: string) =>
  client.get<Ec2Instance[]>('/aws/ec2/instances', { params: region ? { region } : {} }).then(r => r.data)

export const startInstance = (instanceId: string, region?: string) =>
  client.post(`/aws/ec2/instances/${instanceId}/start`, null, { params: region ? { region } : {} })

export const stopInstance = (instanceId: string, region?: string) =>
  client.post(`/aws/ec2/instances/${instanceId}/stop`, null, { params: region ? { region } : {} })

export const terminateInstance = (instanceId: string, region?: string) =>
  client.delete(`/aws/ec2/instances/${instanceId}`, { params: region ? { region } : {} })

export const listS3Buckets = () =>
  client.get<S3Bucket[]>('/aws/s3/buckets').then(r => r.data)

export const listEcsClusters = (region?: string) =>
  client.get<EcsCluster[]>('/aws/ecs/clusters', { params: region ? { region } : {} }).then(r => r.data)

export const listEcsServices = (clusterArn: string, region?: string) =>
  client.get<EcsService[]>(`/aws/ecs/clusters/${encodeURIComponent(clusterArn)}/services`, {
    params: region ? { region } : {},
  }).then(r => r.data)
