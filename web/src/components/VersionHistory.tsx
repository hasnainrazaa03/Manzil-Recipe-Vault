import { useState } from 'react';
import { toast } from 'react-toastify';
import { Modal } from './Modal';
import { ConfirmDialog } from './ConfirmDialog';
import { Icon } from './Icon';
import { useRecipeVersions, useRestoreVersion } from '../lib/queries';
import { formatRelativeDate } from '../lib/format';
import { ApiError } from '../lib/api';
import type { RecipeVersionSummary } from '../types';

interface VersionHistoryProps {
  recipeId: string;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * The edit history for a recipe, visible to its author.
 *
 * Restoring writes a *new* version rather than rewinding, so the history is
 * append-only and a restore can itself be undone. That property is what makes
 * the button safe to press, so the confirmation says so explicitly rather than
 * asking "are you sure?" and leaving the reader to guess the consequences.
 */
export function VersionHistory({ recipeId, isOpen, onClose }: VersionHistoryProps) {
  const { data: versions, isPending, isError, refetch } = useRecipeVersions(recipeId, isOpen);
  const restore = useRestoreVersion(recipeId);
  const [pending, setPending] = useState<RecipeVersionSummary | null>(null);

  const handleRestore = async () => {
    if (!pending) return;
    try {
      await restore.mutateAsync(pending.version);
      toast.success(`Restored the version from ${formatRelativeDate(pending.createdAt)}.`);
      setPending(null);
      onClose();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not restore that version.');
      setPending(null);
    }
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Edit history">
        {isPending ? (
          <p className="field-hint">Loading history…</p>
        ) : isError ? (
          <div className="error-state" role="alert">
            <p>Could not load the history.</p>
            <button type="button" className="btn-secondary btn-sm" onClick={() => void refetch()}>
              Try again
            </button>
          </div>
        ) : versions.length === 0 ? (
          <p className="empty-comments">
            No previous versions yet. One is saved automatically each time you edit this recipe.
          </p>
        ) : (
          <ol className="version-list">
            {versions.map((version) => (
              <li key={version._id} className="version-row">
                <div className="version-meta">
                  <span className="version-number">Version {version.version}</span>
                  <time dateTime={version.createdAt}>{formatRelativeDate(version.createdAt)}</time>
                  {version.restoredFrom !== null && (
                    <span className="version-restored">
                      restored from version {version.restoredFrom}
                    </span>
                  )}
                </div>
                <p className="version-title">{version.snapshot.title}</p>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => setPending(version)}
                >
                  <Icon name="history" size={15} />
                  <span>Restore</span>
                </button>
              </li>
            ))}
          </ol>
        )}

        <p className="field-hint">
          The most recent {versions?.length ?? 0} edits are kept. Older versions are discarded.
        </p>
      </Modal>

      <ConfirmDialog
        isOpen={pending !== null}
        title={`Restore version ${pending?.version ?? ''}?`}
        message="Your current version is saved to the history first, so you can undo this straight afterwards."
        confirmLabel="Restore it"
        isPending={restore.isPending}
        onConfirm={handleRestore}
        onCancel={() => setPending(null)}
      />
    </>
  );
}
