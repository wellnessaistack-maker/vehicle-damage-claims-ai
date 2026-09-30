"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

import { reportClientError } from "@/lib/client/report.ts";

// Keeps a display problem in one part of the screen from taking down the rest,
// and sends the details to the server log.
export class ErrorBoundary extends Component<{ children: ReactNode; label: string; className?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportClientError(this.props.label, error, info.componentStack ?? undefined);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className={this.props.className ?? "col"}>
        <div className="failure" style={{ margin: 16 }}>
          <b>This part of the screen hit a problem.</b> The rest of the worklist still works.
          <div className="hint" style={{ marginTop: 6 }}>
            {this.props.label}: {this.state.error.message}
          </div>
          <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      </div>
    );
  }
}
