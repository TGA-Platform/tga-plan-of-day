import React from 'react';

interface State { error: Error | null }

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
          <h2 style={{ color: '#dc2626' }}>Something went wrong</h2>
          <pre style={{ background: '#fef2f2', padding: '1rem', borderRadius: '8px', fontSize: '12px', overflow: 'auto' }}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <button onClick={() => { this.setState({ error: null }); window.history.back(); }}
            style={{ marginTop: '1rem', padding: '0.5rem 1rem', background: '#A0D083', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
            ← Go back
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
