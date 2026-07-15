import { Link } from 'react-router-dom'
import { Check, Circle, Server, GitFork, Rocket } from 'lucide-react'

interface Step {
  label: string
  done: boolean
  to: string
  icon: React.ElementType
}

/** First-run guide shown on the Dashboard until the account has a machine, a
 * GitHub connection, and a deployment — replaces discovering each page's own
 * empty state one at a time. */
export default function OnboardingGuide({ hasMachine, hasGithub, hasDeployment }: {
  hasMachine: boolean; hasGithub: boolean; hasDeployment: boolean
}) {
  const steps: Step[] = [
    { label: 'Register a machine', done: hasMachine, to: '/machines', icon: Server },
    { label: 'Connect GitHub', done: hasGithub, to: '/github', icon: GitFork },
    { label: 'Deploy something', done: hasDeployment, to: '/deployments', icon: Rocket },
  ]

  return (
    <div className="bg-card border border-border rounded-xl p-5 mb-6 animate-fade-up">
      <h3 className="text-sm font-semibold text-foreground mb-1">Get started with Arise</h3>
      <p className="text-xs text-muted-foreground mb-4">Three steps to your first deployment.</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {steps.map(({ label, done, to, icon: Icon }) => (
          <Link
            key={label}
            to={to}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors ${
              done ? 'border-border bg-muted/10' : 'border-border hover:bg-muted/20'
            }`}
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
              done ? 'bg-chart-5/20 text-chart-5' : 'bg-primary/15 text-primary'
            }`}>
              {done ? <Check size={14} /> : <Icon size={14} />}
            </div>
            <span className={`text-sm ${done ? 'text-muted-foreground line-through' : 'text-foreground font-medium'}`}>
              {label}
            </span>
            {!done && <Circle size={6} className="fill-primary text-primary ml-auto shrink-0" />}
          </Link>
        ))}
      </div>
    </div>
  )
}
