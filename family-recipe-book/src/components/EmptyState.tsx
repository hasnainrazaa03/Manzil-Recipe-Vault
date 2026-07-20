import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

interface EmptyStateProps {
  icon?: IconName;
  title: string;
  message?: string;
  action?: ReactNode;
}

export function EmptyState({ icon = 'folder', title, message, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <Icon name={icon} size={44} />
      <p className="empty-state-title">{title}</p>
      {message && <p className="empty-state-message">{message}</p>}
      {action}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

/**
 * The visible half of the fix for the blank-page crashes: a failed query now
 * renders this instead of letting `undefined.length` throw during render.
 */
export function ErrorState({ title = 'Could not load this', message, onRetry }: ErrorStateProps) {
  return (
    <div className="error-state" role="alert">
      <Icon name="warning" size={40} />
      <h2>{title}</h2>
      <p>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-primary">
          Try again
        </button>
      )}
    </div>
  );
}
