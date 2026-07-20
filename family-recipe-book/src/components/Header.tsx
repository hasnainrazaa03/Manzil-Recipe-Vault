import { Link, NavLink, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { Icon } from './Icon';
import { ThemeToggle } from './ThemeToggle';
import { useAuth } from '../context/AuthContext';
import { useCurrentUser } from '../lib/queries';

export function Header() {
  const { user, logout } = useAuth();
  const { data: profile } = useCurrentUser();
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
