import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import Login from '../Login'
import Register from '../Register'
import Dashboard from '../Dashboard'
import Machines from '../Machines'
import Containers from '../Containers'
import Deployments from '../Deployments'
import CiCd from '../CiCd'
import Topology from '../Topology'
import GitHub from '../GitHub'
import Cloudflare from '../Cloudflare'
import AWS from '../AWS'
import Settings from '../Settings'

const PAGES: Array<[string, React.ComponentType]> = [
  ['Login', Login],
  ['Register', Register],
  ['Dashboard', Dashboard],
  ['Machines', Machines],
  ['Containers', Containers],
  ['Deployments', Deployments],
  ['CiCd', CiCd],
  ['Topology', Topology],
  ['GitHub', GitHub],
  ['Cloudflare', Cloudflare],
  ['AWS', AWS],
  ['Settings', Settings],
]

describe('page smoke render', () => {
  it.each(PAGES)('%s renders without crashing', (_name, Page) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Page />
        </MemoryRouter>
      </QueryClientProvider>
    )
    expect(container).not.toBeEmptyDOMElement()
  })
})
