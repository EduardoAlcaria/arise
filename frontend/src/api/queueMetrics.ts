import client from './client'

export interface QueueDepth {
  queueName: string
  ready: number
  unacknowledged: number
  total: number
}

export const getQueueMetrics = () => client.get<QueueDepth[]>('/queue-metrics').then((r) => r.data)
