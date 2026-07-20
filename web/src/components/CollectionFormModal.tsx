import { useEffect, useId, useState, type FormEvent } from 'react';
import { Modal } from './Modal';
import { Icon } from './Icon';
import type { CollectionInput } from '../types';

interface CollectionFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Prefills the fields when editing; omit to create. */
  initial?: { name: string; description: string; isPublic: boolean };
  title: string;
  submitLabel: string;
  isSaving: boolean;
  errors: string[];
  onSubmit: (input: CollectionInput) => void;
}

const NAME_MAX = 60;
const DESCRIPTION_MAX = 300;

/** The one form behind both "New collection" and "Edit collection". */
export function CollectionFormModal({
  isOpen,
  onClose,
  initial,
  title,
  submitLabel,
  isSaving,
  errors,
  onSubmit,
}: CollectionFormModalProps) {
  const nameId = useId();
  const descriptionId = useId();
  const publicId = useId();

  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [isPublic, setIsPublic] = useState(initial?.isPublic ?? false);

  // Reset each time the dialog opens, so a cancelled edit does not leak into
  // the next one.
  useEffect(() => {
    if (!isOpen) return;
    setName(initial?.name ?? '');
    setDescription(initial?.description ?? '');
    setIsPublic(initial?.isPublic ?? false);
  }, [isOpen, initial?.name, initial?.description, initial?.isPublic]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === '') return;
    onSubmit({ name: name.trim(), description: description.trim(), isPublic });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <form className="collection-form" onSubmit={handleSubmit} noValidate>
        {errors.length > 0 && (
          <div className="form-errors" role="alert">
            <Icon name="warning" size={18} />
            <ul>
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="field">
          <label htmlFor={nameId}>Name</label>
          <input
            id={nameId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={NAME_MAX}
            placeholder="Weeknight dinners"
            required
          />
        </div>

        <div className="field">
          <label htmlFor={descriptionId}>Description</label>
          <textarea
            id={descriptionId}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            maxLength={DESCRIPTION_MAX}
            placeholder="What belongs in here?"
          />
          <span className="field-hint">
            {description.length}/{DESCRIPTION_MAX}
          </span>
        </div>

        <div className="field field--checkbox">
          <input
            id={publicId}
            type="checkbox"
            checked={isPublic}
            onChange={(event) => setIsPublic(event.target.checked)}
          />
          <label htmlFor={publicId}>Make this collection public</label>
          <span className="field-hint">
            Public collections can be opened by anyone with the link. Private ones are only visible
            to you.
          </span>
        </div>

        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={isSaving || name.trim() === ''}>
            {isSaving ? 'Saving…' : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
