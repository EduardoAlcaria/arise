import client from './client'
import type { AuditEntry, Page } from '../types'

export const getAuditLog = (page = 0, size = 10) =>
  client.get<Page<AuditEntry>>('/audit', { params: { page, size, sort: 'timestamp,desc' } }).then((r) => r.data)
