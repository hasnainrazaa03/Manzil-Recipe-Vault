import { Link } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';

export default function NotFoundPage() {
  return (
    <EmptyState
      icon="folder"
      title="Page not found"
      message="The page you were looking for does not exist or has moved."
      action={
        <Link to="/" className="btn-primary">
          Back to recipes
        </Link>
      }
    />
  );
}
