import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../stores/authStore'

export function useDeploymentNotifications() {
  const queryClient = useQueryClient()
  const token = useAuthStore(state => state.token)

  useEffect(() => {
    if (!token) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${window.location.host}/ws/notifications?token=${token}`

    let ws: WebSocket
    let reconnectTimer: ReturnType<typeof setTimeout>
    let destroyed = false

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
        if (!destroyed) {
          reconnectTimer = setTimeout(connect, 5000)
        }
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      destroyed = true
      clearTimeout(reconnectTimer)
      ws?.close()
    }
  }, [queryClient, token])
}
