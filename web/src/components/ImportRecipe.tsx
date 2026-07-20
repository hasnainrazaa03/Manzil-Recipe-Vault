import { useState, type FormEvent } from 'react';
import { Icon } from './Icon';
import { api, ApiError } from '../lib/api';
import type { ImportedRecipe } from '../types';

interface ImportRecipeProps {
  onImported: (recipe: ImportedRecipe) => void;
}

/**
 * Fills the recipe form from a link.
 *
 * It deliberately does not save anything. The parse is best-effort — sites vary,
 * and some publish nothing readable — so the result lands in the form for the
 * author to check and correct. Importing straight into the database would mean
 * a bad parse silently produces a bad recipe, and the person who pasted the link
 * would never see what was taken.
 */
export function ImportRecipe({ onImported }: ImportRecipeProps) {
  const [url, setUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<{ name: string; url: string } | null>(null);

  const handleImport = async (event: FormEvent) => {
    event.preventDefault();
    if (!url.trim()) return;

    setIsImporting(true);
    setError(null);

    try {
      const recipe = await api.importRecipe(url.trim());
      onImported(recipe);
      setSource({ name: recipe.sourceName || 'the original page', url: recipe.sourceUrl });
      setUrl('');
    } catch (importError) {
      setError(
        importError instanceof ApiError
          ? importError.message
          : 'Could not read that page. You can still add the recipe by hand.',
      );
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="import-recipe">
      <div className="import-recipe-intro">
        <Icon name="link" size={18} />
        <div>
          <h3>Import from a link</h3>
          <p className="field-hint">
            Paste a recipe URL and the fields below will be filled in for you to check.
          </p>
        </div>
      </div>

      {/* A nested <form> is invalid HTML — this sits inside the recipe form, so
          it is a row of controls with an explicit click handler instead, and
          Enter is handled on the input. */}
      <div className="import-recipe-row">
        <label htmlFor="import-url" className="visually-hidden">
          Recipe URL
        </label>
        <input
          id="import-url"
          type="url"
          inputMode="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void handleImport(event);
            }
          }}
          placeholder="https://a-food-blog.com/best-biryani"
          disabled={isImporting}
        />
        <button
          type="button"
          className="btn-secondary"
          onClick={(event) => void handleImport(event)}
          disabled={isImporting || !url.trim()}
        >
          {isImporting ? 'Reading…' : 'Import'}
        </button>
      </div>

      {error && (
        <p className="import-recipe-error" role="alert">
          <Icon name="warning" size={16} />
          <span>{error}</span>
        </p>
      )}

      {source && !error && (
        <p className="import-recipe-source" role="status">
          <Icon name="check" size={16} />
          <span>
            Filled in from{' '}
            <a href={source.url} target="_blank" rel="noopener noreferrer nofollow">
              {source.name}
            </a>
            . Check it over before saving.
          </span>
        </p>
      )}
    </div>
  );
}
