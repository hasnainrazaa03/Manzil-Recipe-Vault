import { Link, NavLink, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { Icon } from './Icon';
import { ThemeToggle } from './ThemeToggle';
import { useAuth } from '../context/AuthContext';
import { useCurrentUser } from '../lib/queries';
import { useShoppingList } from '../hooks/useShoppingList';

export function Header({ onOpenPalette }: { onOpenPalette?: () => void }) {
  const { user, logout } = useAuth();
  const { data: profile } = useCurrentUser();
  const { remaining } = useShoppingList();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    toast.info('Signed out.');
    navigate('/');
  };

  const displayName = profile?.displayName || user?.email?.split('@')[0] || '';

  return (
    <header>
      {/* First tab stop on the page, so keyboard users can jump the nav. */}
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <Link to="/" className="header-brand" aria-label="Manzil Recipe Vault, home">
        <img src="/logo.png" alt="" className="header-logo" width={150} height={40} />
      </Link>

      <nav className="header-nav" aria-label="Main">
        {onOpenPalette && (
          <button
            type="button"
            className="palette-trigger"
            onClick={onOpenPalette}
            aria-label="Search recipes and commands"
          >
            <Icon name="search" size={16} />
            <span className="palette-trigger-text">Search</span>
            <kbd>⌘K</kbd>
          </button>
        )}

        <NavLink to="/shopping-list" className="nav-link nav-link--icon" aria-label="Shopping list">
          <Icon name="cart" size={18} />
          {remaining > 0 && (
            <span className="nav-badge" aria-label={`${remaining} items outstanding`}>
              {remaining > 99 ? '99+' : remaining}
            </span>
          )}
        </NavLink>

        {user ? (
          <>
            <NavLink to="/saved-recipes" className="nav-link">
              Saved
            </NavLink>
            <NavLink to={`/profile/${user.uid}`} className="nav-link">
              My profile
            </NavLink>
            <ThemeToggle />
            <span className="user-greeting" title={user.email ?? ''}>
              {displayName}
            </span>
            <button onClick={handleLogout} className="logout-button" type="button">
              Log out
            </button>
          </>
        ) : (
          <>
            <ThemeToggle />
            <Link to="/login" className="login-button">
              <Icon name="user" size={16} />
              <span>Log in</span>
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
