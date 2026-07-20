import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';

import { Icon } from '../components/Icon';
import { Pagination } from '../components/Pagination';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { FollowButton } from '../components/FollowButton';
import { useFollowers, useFollowing } from '../lib/queries';
import { ApiError } from '../lib/api';

/**
 * One page for both `/profile/:userId/followers` and `/profile/:userId/following`.
 * The route decides which query runs; everything else is identical, and two
 * near-copies would only drift.
 */
export default function FollowListPage() {
  const { userId } = useParams<{ userId: string }>();
  const location = useLocation();
  const [page, setPage] = useState(1);

  const mode: 'followers' | 'following' = location.pathname.endsWith('/following')
    ? 'following'
    : 'followers';

  // Both hooks are always called — hooks cannot be conditional — but only the
  // one for the current route is enabled by passing the id to it.
  const followers = useFollowers(mode === 'followers' ? userId : undefined, page);
  const following = useFollowing(mode === 'following' ? userId : undefined, page);
  const query = mode === 'followers' ? followers : following;

  const { data, isPending, isError, error, refetch } = query;
  const heading = mode === 'followers' ? 'Followers' : 'Following';

  return (
    <div className="follow-list-page">
      <header className="follow-list-header">
        <h1>{heading}</h1>
        {userId && (
          <Link to={`/profile/${userId}`} className="follow-list-back">
            <Icon name="chevron-left" size={16} />
            <span>Back to profile</span>
          </Link>
        )}
      </header>

      {isPending ? (
        <ul className="follow-list" aria-busy="true" aria-label={`Loading ${heading.toLowerCase()}`}>
          {Array.from({ length: 5 }, (_, index) => (
            <li className="follow-list-row follow-list-row--skeleton" key={index} aria-hidden="true">
              <div className="skeleton skeleton-avatar" />
              <div className="skeleton skeleton-line skeleton-line--short" />
            </li>
          ))}
        </ul>
      ) : isError ? (
        <ErrorState
          message={
            error instanceof ApiError && error.status === 404
              ? 'That user does not exist.'
              : error instanceof ApiError
                ? error.message
                : `Could not load ${heading.toLowerCase()}.`
          }
          onRetry={() => void refetch()}
        />
      ) : data.items.length === 0 ? (
        <EmptyState
          icon="users"
          title={mode === 'followers' ? 'No followers yet' : 'Not following anyone yet'}
          message={
            mode === 'followers'
              ? 'When someone follows this cook, they show up here.'
              : 'Recipes from the people this cook follows would appear in their feed.'
          }
        />
      ) : (
        <ul className="follow-list">
          {data.items.map((person) => (
            <li className="follow-list-row" key={person.uid}>
              <Link to={`/profile/${person.uid}`} className="follow-list-link">
                {person.profilePictureUrl ? (
                  <img
                    src={person.profilePictureUrl}
                    alt=""
                    className="follow-list-avatar"
                    referrerPolicy="no-referrer"
                    loading="lazy"
                  />
                ) : (
                  <span className="follow-list-avatar follow-list-avatar--placeholder" aria-hidden="true">
                    <Icon name="user" size={20} />
                  </span>
                )}
                <span className="follow-list-details">
                  <span className="follow-list-name">{person.displayName}</span>
                  {person.bio && <span className="follow-list-bio">{person.bio}</span>}
                  <span className="follow-list-count">
                    {person.followerCount} {person.followerCount === 1 ? 'follower' : 'followers'}
                  </span>
                </span>
              </Link>

              <FollowButton userId={person.uid} displayName={person.displayName} size="small" />
            </li>
          ))}
        </ul>
      )}

      {!isPending && !isError && (
        <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
      )}
    </div>
  );
}
