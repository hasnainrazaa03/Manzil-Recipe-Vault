import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Icon } from './Icon';

interface Props {
  children: ReactNode;
  /** Changing this resets the boundary — pass the route key to clear on navigation. */
  resetKey?: string;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Stops one thrown render from blanking the whole application.
 *
 * Several existing crash paths ended here: a list endpoint returning an error
 * envelope made `recipes` undefined, and the next `.length` threw during render
 * with nothing to catch it, unmounting the entire tree to a white page.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidUpdate(prevProps: Props): void {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Render error caught by boundary:', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="error-state" role="alert">
        <Icon name="warning" size={40} />
        <h2>Something went wrong</h2>
        <p>{error.message || 'An unexpected error occurred while rendering this page.'}</p>
        <div className="error-state-actions">
          <button type="button" onClick={this.reset} className="btn-primary">
            Try again
          </button>
          <button type="button" onClick={() => window.location.assign('/')} className="btn-secondary">
            Go home
          </button>
        </div>
      </div>
    );
  }
}
