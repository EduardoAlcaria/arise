import client from './client'

export const getWebhookToken = () =>
  client.get<{ webhookToken: string; webhookSecret: string }>('/settings/webhook-token').then(r => r.data)
