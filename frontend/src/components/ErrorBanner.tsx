import { AlertTriangle } from 'lucide-react'
import type { ReactNode } from 'react'

/** Standard inline error banner — replaces the ad-hoc destructive-box JSX that
 * used to be duplicated across Login, Register, Settings, Deployments, AWS, and
 * DeployRepoWizard. `className` carries per-context spacing (mb-3, mb-5, ...). */
export default function ErrorBanner({ message, className = '' }: { message: ReactNode; className?: string }) {
  if (!message) return null
  return (
    <div className={`flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-xs text-destructive border border-destructive/20 bg-destructive/5 ${className}`}>
      <AlertTriangle size={13} className="shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  )
}

/** Extracts a human-readable message from an axios-style mutation error. */
export function errorMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string } | null
  return e?.response?.data?.message ?? e?.message ?? fallback
}
