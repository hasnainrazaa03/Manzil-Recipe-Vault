import { useEffect, useRef } from 'react';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  isPending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Replaces the confirm-inside-a-toast pattern. A toast auto-dismisses, can be
 * swiped away, stacks with other toasts, and is not announced as requiring a
 * decision — none of which suits "permanently delete this recipe?".
 */
export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDestructive = false,
  isPending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus the safe option, so a stray Enter cannot delete anything.
  useEffect(() => {
    if (isOpen) requestAnimationFrame(() => cancelRef.current?.focus());
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title}>
      <p className="confirm-message">{message}</p>
      <div className="confirm-actions">
        <button type="button" ref={cancelRef} onClick={onCancel} className="btn-secondary" disabled={isPending}>
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={isDestructive ? 'btn-danger' : 'btn-primary'}
          disabled={isPending}
        >
          {isPending ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
