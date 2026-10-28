import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { useStore } from './store'
import { startLoadQueue } from './three/loadQueue'
import type { CopyDoc, Manifest } from './types'
import './styles.css'

async function boot() {
  const [manifest, copy] = await Promise.all([
    fetch(`${import.meta.env.BASE_URL}scene.json`).then((r) => r.json() as Promise<Manifest>),
    fetch(`${import.meta.env.BASE_URL}content/copy.json`).then((r) => r.json() as Promise<CopyDoc>),
  ])
  useStore.setState({ manifest, copy })
  startLoadQueue()

  // The browser shouldn't restore a mid-carousel scroll position on reload.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual'

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

boot()
