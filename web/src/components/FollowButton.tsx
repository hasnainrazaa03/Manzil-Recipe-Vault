import { useState } from 'react';
import { toast } from 'react-toastify';
import { Icon } from './Icon';
import { useAuth } from '../context/AuthContext';
import { useRelationship, useToggleFollow } from '../lib/queries';
import { ApiError } from '../lib/api';

interface FollowButtonProps {
  userId: string;
  /** Disambiguates the accessible name when several buttons sit in one list. */
  displayName?: string;
  size?: 'default' | 'small';
}

/**
 * Follow / Following, with "Unfollow" surfacing on hover so the destructive
 * reading of a second click is visible before it happens.
 *
 * The state is never carried by colour alone: the label and the icon both
 * change, and `aria-pressed` carries it for assistive technology.
 */
export function FollowButton({ userId, displayName, size = 'default' }: FollowButtonProps) {
  const { user } = useAuth();
  const { data: relationship, isPending, isError } = useRelationship(userId);
  const toggleFollow = useToggleFollow();
  const [isHovered, setIsHovered] = useState(false);

  // Signed-out visitors have nobody to follow with, and the relationship query
  // is disabled for them — there is nothing meaningful to render.
  if (!user) return null;

  // Never render `relationship.following` before it exists: a follow button
  // that guesses is worse than one that waits.
  if (isPending || isError || !relationship) return null;

  if (relationship.isSelf) return null;

  const { following } = relationship;
  const label = following ? (isHovered ? 'Unfollow' : 'Following') : 'Follow';

  const handleClick = () => {
    toggleFollow.mutate(userId, {
      onError: (error) => {
        toast.error(
          error instanceof ApiError ? error.message : 'Could not update who you follow.',
        );
      },
    });
  };

  return (
    <button
      type="button"
      className={`follow-button ${following ? 'follow-button--following' : ''} ${
        size === 'small' ? 'follow-button--small' : ''
      }`}
      aria-pressed={following}
      aria-label={displayName ? `${label} ${displayName}` : undefined}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Icon name={following ? 'check' : 'plus'} size={16} />
      <span className="follow-button-label">{label}</span>
      {relationship.followsYou && !following && (
        <span className="follow-button-hint">Follows you</span>
      )}
    </button>
  );
}
