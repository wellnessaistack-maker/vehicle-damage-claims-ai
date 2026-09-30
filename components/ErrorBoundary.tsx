"use client";

import { Component, type ReactNode } from "react";

// Keeps one claim's display problem from blanking the whole worklist.
export class ErrorBoundary extends Component<{ children: ReactNode; label: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`${this.props.label} failed to display`, error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <aside className="col assess">
        <div className="failure" style={{ margin: 16 }}>
          <b>This claim couldn&apos;t be displayed.</b> {this.state.error.message}
          <div style={{ marginTop: 6 }}>The rest of the worklist still works. Pick another claim, or try this one again.</div>
          <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      </aside>
    );
  }
}
