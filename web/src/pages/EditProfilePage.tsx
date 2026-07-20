import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { Icon } from '../components/Icon';
import { ErrorState } from '../components/EmptyState';
import { useAuth } from '../context/AuthContext';
import { useCurrentUser, useUpdateProfile } from '../lib/queries';
import { ApiError, uploadImage } from '../lib/api';

export default function EditProfilePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: profile, isPending, isError, refetch } = useCurrentUser();
  const updateProfile = useUpdateProfile();

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [pictureUrl, setPictureUrl] = useState('');
  const [pictureFile, setPictureFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.displayName);
    setBio(profile.bio);
    setPictureUrl(profile.profilePictureUrl);
  }, [profile]);

  useEffect(() => {
    if (!pictureFile) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(pictureFile);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [pictureFile]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setErrors([]);

    try {
      /**
       * The avatar now goes through the server-signed upload path. It used to
       * post straight to Cloudinary with an unsigned preset whose name shipped
       * in the client bundle — effectively public write access to the account's
       * storage for anyone who read the JavaScript.
       */
      let finalUrl = pictureUrl;
      if (pictureFile) {
        setIsUploading(true);
        try {
          finalUrl = await uploadImage(pictureFile, 'avatar');
        } finally {
          setIsUploading(false);
        }
      }

      await updateProfile.mutateAsync({
        displayName: displayName.trim(),
        bio: bio.trim(),
        profilePictureUrl: finalUrl,
      });

      toast.success('Profile updated.');
      if (user) navigate(`/profile/${user.uid}`);
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(error.fieldMessages.length > 0 ? error.fieldMessages : [error.message]);
      } else {
        setErrors([(error as Error).message || 'Could not save your profile.']);
      }
    }
  };

  if (isPending) {
    return (
      <div className="loading-container">
        <div className="spinner" />
        <p>Loading your profile…</p>
      </div>
    );
  }

  if (isError) {
    return <ErrorState message="Could not load your profile." onRetry={() => void refetch()} />;
  }

  const shownPicture = preview ?? pictureUrl;
  const isSaving = updateProfile.isPending || isUploading;

  return (
    <div className="form-container">
      <h1>Edit profile</h1>

      <form onSubmit={handleSubmit} noValidate>
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
          <label htmlFor="display-name">Display name</label>
          <input
            id="display-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={60}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="bio">Bio</label>
          <textarea
            id="bio"
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            rows={4}
            maxLength={500}
            placeholder="A little about you and the food you cook"
          />
          <span className="field-hint">{bio.length}/500</span>
        </div>

        <div className="field">
          <label htmlFor="profile-picture">Profile picture</label>
          {shownPicture && (
            <div className="avatar-preview">
              <img
                src={shownPicture}
                alt="Your profile picture"
                className="profile-avatar"
                referrerPolicy="no-referrer"
              />
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => {
                  setPictureFile(null);
                  setPictureUrl('');
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
              >
                Remove
              </button>
            </div>
          )}
          <input
            id="profile-picture"
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => setPictureFile(event.target.files?.[0] ?? null)}
          />
          <span className="field-hint">JPEG, PNG or WebP, up to 10&nbsp;MB.</span>
        </div>

        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)} disabled={isSaving}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={isSaving}>
            {isUploading ? 'Uploading…' : isSaving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
