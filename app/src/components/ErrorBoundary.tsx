import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Optional override for the rendered fallback. */
  fallback?: (err: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Root-level error boundary.
 *
 * Without this, a thrown exception anywhere in the tree takes the SPA to a
 * blank white page with only a console error. With this, the user sees a
 * plain recovery screen and can reload without losing their session cookie.
 *
 * Per-page boundaries (e.g. around a data-fetching widget) can still be
 * added later for scoped recovery — this one is the net that catches
 * the rest.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // In production you'd ship this to Sentry/Logflare. For Phase 0 the
    // browser console is the only sink; keep the shape stable so Phase 5
    // observability work doesn't have to change call sites.
    console.error('[ErrorBoundary] caught', { error, componentStack: info.componentStack });
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <main
        style={{
          maxWidth: 520,
          margin: '0 auto',
          padding: '80px 24px',
          textAlign: 'center',
          color: 'var(--color-ink)',
        }}
      >
        <h1 style={{ fontSize: 28, marginBottom: 12 }}>Something went wrong.</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
          Mane Line hit an unexpected error. Reloading usually fixes it. If this keeps
          happening, email <a href="mailto:support@maneline.co">support@maneline.co</a>.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '12px 20px',
            fontSize: 15,
            fontWeight: 600,
            background: 'var(--color-primary)',
            color: '#fff',
            border: 0,
            borderRadius: 10,
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </main>
    );
  }
}
