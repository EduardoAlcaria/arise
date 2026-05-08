import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { X } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import '@xterm/xterm/css/xterm.css'

interface Props {
  machineId: number
  machineName: string
  onClose: () => void
}

export default function TerminalModal({ machineId, machineName, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const token = useAuthStore.getState().token

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "'Fira Code', 'Cascadia Code', monospace",
      fontSize: 13,
      lineHeight: 1.45,
      scrollback: 5000,
      theme: {
        background: '#0d0d0d',
        foreground: '#d4d4d4',
        cursor: '#4ade80',
        cursorAccent: '#000',
        selectionBackground: '#ffffff25',
        black:         '#1e1e1e', red:          '#f44747',
        green:         '#4ade80', yellow:       '#dcdcaa',
        blue:          '#569cd6', magenta:      '#c586c0',
        cyan:          '#4ec9b0', white:        '#d4d4d4',
        brightBlack:   '#808080', brightRed:    '#f44747',
        brightGreen:   '#6bcf7f', brightYellow: '#ffd700',
        brightBlue:    '#9cdcfe', brightMagenta:'#d197d9',
        brightCyan:    '#23d18b', brightWhite:  '#ffffff',
      },
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/terminal/${machineId}?token=${token}`)
    ws.binaryType = 'arraybuffer'

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    }

    ws.onmessage = ev => {
      if (ev.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(ev.data))
      } else {
        term.write(String(ev.data))
      }
    }

    ws.onclose  = () => term.write('\r\n\x1b[2m[disconnected]\x1b[0m\r\n')
    ws.onerror  = () => term.write('\r\n\x1b[31m[connection error]\x1b[0m\r\n')

    term.onData(data => ws.readyState === WebSocket.OPEN && ws.send(data))

    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
    })

    const ro = new ResizeObserver(() => fitAddon.fit())
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      ws.close()
      term.dispose()
    }
  }, [machineId, token])

  return (
    <div
      className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="flex flex-col rounded-xl overflow-hidden shadow-2xl animate-fade-up"
        style={{
          width: 'min(1000px, calc(100vw - 32px))',
          height: 'min(640px, calc(100vh - 32px))',
          background: '#0d0d0d',
          border: '1px solid #1e1e1e',
        }}
      >
        {/* Title bar */}
        <div
          className="flex items-center gap-3 px-4 shrink-0"
          style={{ height: '38px', background: '#161616', borderBottom: '1px solid #222' }}
        >
          <span className="flex-1 text-xs text-[#666] font-mono select-none">{machineName}</span>
          <button onClick={onClose} className="text-[#555] hover:text-[#888] transition-colors">
            <X size={13} />
          </button>
        </div>

        {/* xterm mount point — padding keeps the text off the edges */}
        <div ref={containerRef} className="flex-1 overflow-hidden" style={{ padding: '8px' }} />
      </div>
    </div>
  )
}
