import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div style={{
          padding: '24px',
          margin: '16px 0',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid var(--color-danger)',
          borderRadius: 'var(--radius-md)',
          color: '#fff',
          fontFamily: 'sans-serif'
        }}>
          <h3 style={{ color: 'var(--color-danger)', marginBottom: '10px', fontSize: '1.1rem', fontWeight: 600 }}>
            ⚠️ エラーが発生しました
          </h3>
          <p style={{ fontFamily: 'monospace', fontSize: '0.9rem', background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '6px', whiteSpace: 'pre-wrap', color: '#ff8888' }}>
            {this.state.error?.stack || this.state.error?.toString()}
          </p>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="btn btn-primary"
              style={{ padding: '6px 14px', fontSize: '0.85rem', cursor: 'pointer' }}
            >
              再試行 (Retry)
            </button>
            <button
              onClick={() => window.location.reload()}
              className="btn btn-secondary"
              style={{ padding: '6px 14px', fontSize: '0.85rem', cursor: 'pointer' }}
            >
              ページを再読み込み (Reload)
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
