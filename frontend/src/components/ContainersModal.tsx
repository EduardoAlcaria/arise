import { useQuery } from '@tanstack/react-query'
import { X, RefreshCw, Box } from 'lucide-react'
import { execOnMachine } from '../api/machines'

interface Props {
  machineId: number
  machineName: string
  onClose: () => void
}

interface Row {
  id: string
  name: string
  image: string
  status: string
  ports: string
}

const FORMAT = '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'

function parsePs(stdout: string): Row[] {
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, name, image, status, ports] = line.split('\t')
      return { id, name, image, status, ports: ports ?? '' }
    })
}

export default function ContainersModal({ machineId, machineName, onClose }: Props) {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['machine-containers', machineId],
    queryFn: () => execOnMachine(machineId, `docker ps --format "${FORMAT}"`),
    refetchInterval: 10000,
  })

  const rows = data ? parsePs(data.stdout) : []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-card border border-border rounded-lg w-full max-w-3xl max-h-[80vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Box size={16} className="text-muted-foreground" />
            <h2 className="text-sm font-semibold">Containers — {machineName}</h2>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => refetch()}
              title="Refresh"
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
            </button>
            <button onClick={onClose} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="overflow-auto flex-1 p-4">
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-destructive">Failed to fetch containers.</p>}
          {!isLoading && !error && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">No containers running.</p>
          )}
          {rows.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-1.5 pr-3 font-medium">Name</th>
                  <th className="py-1.5 pr-3 font-medium">Image</th>
                  <th className="py-1.5 pr-3 font-medium">Status</th>
                  <th className="py-1.5 font-medium">Ports</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/50">
                    <td className="py-1.5 pr-3 font-mono">{r.name}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{r.image}</td>
                    <td className="py-1.5 pr-3">
                      <span className={r.status.startsWith('Up') ? 'text-green-500' : 'text-muted-foreground'}>{r.status}</span>
                    </td>
                    <td className="py-1.5 text-muted-foreground">{r.ports || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
