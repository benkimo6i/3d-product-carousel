import { Component, type ReactNode } from 'react'

/** Keeps one product that fails to load from taking down the whole canvas. */
export class ModelErrorBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error(`[carousel] ${this.props.name} failed to load`, error)
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
