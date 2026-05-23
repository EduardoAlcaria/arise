import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../stores/authStore'

export function useDeploymentNotifications() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const token = useAuthStore.getState().token
    if (!token) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${window.location.host}/ws/notifications?token=${token}`

    let ws: WebSocket
    let reconnectTimer: ReturnType<typeof setTimeout>

    function connect() {
      ws = new WebSocket(url)

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string)
          if (msg.type === 'DEPLOYMENT_UPDATE') {
            queryClient.invalidateQueries({ queryKey: ['deployments-all'] })
            queryClient.invalidateQueries({ queryKey: ['dep-watch-status', msg.deploymentId] })
          }
        } catch {
          // non-JSON message, ignore
        }
      }

      ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 5000)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      clearTimeout(reconnectTimer)
      ws?.close()
    }
  }, [queryClient])
}
