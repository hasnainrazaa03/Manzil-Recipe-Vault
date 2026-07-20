import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { Icon } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';
import { useAddComment, useDeleteComment, useEditComment } from '../lib/queries';
import { ApiError } from '../lib/api';
import type { Comment } from '../types';

const AVATAR_FALLBACK = 'https://i.imgur.com/346c9kE.png';
const MAX_LENGTH = 2000;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface CommentSectionProps {
  recipeId: string;
  comments: Comment[];
  commentCount: number;
  currentUserId?: string;
  /** The recipe's author may moderate comments on their own recipe. */
  recipeAuthorId: string;
}

export function CommentSection({
  recipeId,
  comments,
  commentCount,
  currentUserId,
  recipeAuthorId,
}: CommentSectionProps) {
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Comment | null>(null);

  const addComment = useAddComment(recipeId);
  const editComment = useEditComment(recipeId);
  const deleteComment = useDeleteComment(recipeId);

  const handleError = (error: unknown, fallback: string) => {
    toast.error(error instanceof ApiError ? error.message : fallback);
  };

  const submitNew = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;

    try {
      await addComment.mutateAsync(text);
      setDraft('');
    } catch (error) {
      handleError(error, 'Could not post your comment.');
    }
  };

  const submitEdit = async (event: FormEvent, commentId: string) => {
    event.preventDefault();
    const text = editDraft.trim();
    if (!text) return;

    try {
      await editComment.mutateAsync({ commentId, text });
      setEditingId(null);
      setEditDraft('');
    } catch (error) {
      handleError(error, 'Could not save your edit.');
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteComment.mutateAsync(pendingDelete._id);
      toast.success('Comment deleted.');
    } catch (error) {
      handleError(error, 'Could not delete the comment.');
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <section className="comments-section" aria-labelledby="comments-heading">
      <h2 id="comments-heading">
        Comments <span className="count">({commentCount})</span>
      </h2>

      {currentUserId ? (
        <form onSubmit={submitNew} className="comment-form">
          <label htmlFor="new-comment" className="visually-hidden">
            Write a comment
          </label>
          <textarea
            id="new-comment"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Share a tip, a substitution, or how it turned out…"
            rows={3}
            maxLength={MAX_LENGTH}
          />
          <div className="comment-form-footer">
            <span className="field-hint">
              {draft.length}/{MAX_LENGTH}
            </span>
            <button type="submit" className="btn-primary btn-sm" disabled={!draft.trim() || addComment.isPending}>
              {addComment.isPending ? 'Posting…' : 'Post comment'}
            </button>
          </div>
        </form>
      ) : (
        <p className="login-to-comment">
          <Link to="/login">Log in</Link> to join the conversation.
        </p>
      )}

      {comments.length === 0 ? (
        // Shown to everyone. The old version guarded this on being logged out,
        // so signed-in visitors saw an unexplained empty gap.
        <p className="empty-comments">No comments yet. Be the first to share your thoughts.</p>
      ) : (
        <ul className="comments-list">
          {comments.map((comment) => {
            const isCommentAuthor = comment.authorId === currentUserId;
            const canDelete = isCommentAuthor || (currentUserId != null && currentUserId === recipeAuthorId);
            const isEditing = editingId === comment._id;

            return (
              <li key={comment._id} className="comment">
                <div className="comment-author-info">
                  <img
                    src={comment.authorProfilePictureUrl || AVATAR_FALLBACK}
                    alt=""
                    className="comment-avatar"
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.src = AVATAR_FALLBACK;
                    }}
                  />
                  <Link to={`/profile/${comment.authorId}`} className="comment-author-name">
                    {comment.authorDisplayName || 'Anonymous cook'}
                  </Link>
                  <time className="comment-date" dateTime={comment.createdAt}>
                    {formatDate(comment.createdAt)}
                  </time>
                  {comment.editedAt && <span className="comment-edited">(edited)</span>}
                </div>

                {isEditing ? (
                  <form onSubmit={(event) => submitEdit(event, comment._id)} className="comment-edit-form">
                    <label htmlFor={`edit-${comment._id}`} className="visually-hidden">
                      Edit your comment
                    </label>
                    <textarea
                      id={`edit-${comment._id}`}
                      value={editDraft}
                      onChange={(event) => setEditDraft(event.target.value)}
                      rows={3}
                      maxLength={MAX_LENGTH}
                      autoFocus
                    />
                    <div className="comment-actions">
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => {
                          setEditingId(null);
                          setEditDraft('');
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="btn-primary btn-sm"
                        disabled={!editDraft.trim() || editComment.isPending}
                      >
                        Save
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    {/* Comment text is stored HTML-stripped by the server, so it
                        is rendered as plain text — no dangerouslySetInnerHTML. */}
                    <p className="comment-text">{comment.text}</p>

                    {(isCommentAuthor || canDelete) && (
                      <div className="comment-actions">
                        {isCommentAuthor && (
                          <button
                            type="button"
                            className="btn-link btn-sm"
                            onClick={() => {
                              setEditingId(comment._id);
                              setEditDraft(comment.text);
                            }}
                          >
                            <Icon name="edit" size={14} />
                            <span>Edit</span>
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            className="btn-link btn-sm btn-link--danger"
                            onClick={() => setPendingDelete(comment)}
                          >
                            <Icon name="trash" size={14} />
                            <span>Delete</span>
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title="Delete comment"
        message="This comment will be permanently removed."
        confirmLabel="Delete"
        isDestructive
        isPending={deleteComment.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}
