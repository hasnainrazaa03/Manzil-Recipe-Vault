import { useEffect, useRef, useState, type FormEvent } from 'react';
import { toast } from 'react-toastify';
import { RichTextEditor } from './RichTextEditor';
import { Icon } from './Icon';
import { ImportRecipe } from './ImportRecipe';
import { TidyReview, type AcceptedTidy } from './TidyReview';
import { ApiError, uploadImage } from '../lib/api';
import { useAiAvailable, useCreateRecipe, useTidyRecipe, useUpdateRecipe } from '../lib/queries';
import type { Difficulty, Ingredient, RecipeDetail, RecipeInput, TidyResult } from '../types';

const EMPTY_INGREDIENT: Ingredient = { amount: '', name: '' };

interface RecipeFormProps {
  recipeToEdit?: RecipeDetail | null;
  onSaved: (recipe: RecipeDetail) => void;
  onCancel: () => void;
}

interface FormState {
  title: string;
  overview: string;
  tags: string;
  instructions: string;
  /** The image currently attached — a URL, or '' for none. */
  image: string;
  /** Metadata is held as strings so an emptied field stays empty, not zero. */
  servings: string;
  prepMinutes: string;
  cookMinutes: string;
  difficulty: Difficulty | '';
  cuisine: string;
}

const blankForm: FormState = {
  title: '',
  overview: '',
  tags: '',
  instructions: '',
  image: '',
  servings: '',
  prepMinutes: '',
  cookMinutes: '',
  difficulty: '',
  cuisine: '',
};

/** '' means "not stated", which the API stores as null. */
const toOptionalNumber = (value: string): number | null => {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

export function RecipeForm({ recipeToEdit, onSaved, onCancel }: RecipeFormProps) {
  const isEditing = Boolean(recipeToEdit);

  const [form, setForm] = useState<FormState>(blankForm);
  const [ingredients, setIngredients] = useState<Ingredient[]>([EMPTY_INGREDIENT]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const aiAvailable = useAiAvailable();
  const tidy = useTidyRecipe();
  const [proposal, setProposal] = useState<TidyResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const createRecipe = useCreateRecipe();
  const updateRecipe = useUpdateRecipe();
  const isSaving = createRecipe.isPending || updateRecipe.isPending || isUploading;

  useEffect(() => {
    if (recipeToEdit) {
      // Only the writable fields are lifted into form state. The old version
      // spread the entire document — `_id`, `author`, `ratings`, `comments`,
      // `__v` — and posted all of it back on save.
      setForm({
        title: recipeToEdit.title,
        overview: recipeToEdit.overview,
        tags: recipeToEdit.tags.join(', '),
        instructions: recipeToEdit.instructions,
        image: recipeToEdit.image,
        // `null` becomes '' so an unstated value shows as an empty field
        // rather than a spurious 0.
        servings: recipeToEdit.servings?.toString() ?? '',
        prepMinutes: recipeToEdit.prepMinutes?.toString() ?? '',
        cookMinutes: recipeToEdit.cookMinutes?.toString() ?? '',
        difficulty: recipeToEdit.difficulty ?? '',
        cuisine: recipeToEdit.cuisine,
      });
      setIngredients(recipeToEdit.ingredients.length > 0 ? recipeToEdit.ingredients : [EMPTY_INGREDIENT]);
    } else {
      setForm(blankForm);
      setIngredients([EMPTY_INGREDIENT]);
    }
    setImageFile(null);
    setImagePreview(null);
    setErrors([]);
  }, [recipeToEdit]);

  // Revoke the object URL when it changes or the form unmounts, or every image
  // preview leaks for the lifetime of the page.
  useEffect(() => {
    if (!imageFile) {
      setImagePreview(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  const updateIngredient = (index: number, field: keyof Ingredient, value: string) => {
    // Replace the object rather than mutating it in place — the old code copied
    // the array but then wrote through to the shared nested object.
    setIngredients((previous) =>
      previous.map((ingredient, i) => (i === index ? { ...ingredient, [field]: value } : ingredient)),
    );
  };

  const addIngredient = () => setIngredients((previous) => [...previous, { ...EMPTY_INGREDIENT }]);

  const removeIngredient = (index: number) =>
    setIngredients((previous) => previous.filter((_, i) => i !== index));

  const clearImage = () => {
    setImageFile(null);
    updateField('image', '');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setErrors([]);

    const cleanedIngredients = ingredients.filter((ingredient) => ingredient.name.trim() !== '');
    if (cleanedIngredients.length === 0) {
      setErrors(['Add at least one ingredient.']);
      return;
    }

    try {
      /**
       * The image is only replaced when a new file was actually chosen, and is
       * only cleared when the user explicitly removes it.
       *
       * Previously, an upload-mode form with no file selected fell through to a
       * branch that set the image to '' — so opening a saved recipe, switching
       * to the upload tab, and saving silently deleted its picture.
       */
      let imageUrl = form.image;
      if (imageFile) {
        setIsUploading(true);
        try {
          imageUrl = await uploadImage(imageFile, 'recipe');
        } finally {
          setIsUploading(false);
        }
      }

      const input: RecipeInput = {
        title: form.title.trim(),
        overview: form.overview.trim(),
        instructions: form.instructions,
        image: imageUrl,
        ingredients: cleanedIngredients.map((ingredient) => ({
          amount: ingredient.amount.trim(),
          name: ingredient.name.trim(),
        })),
        tags: form.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        servings: toOptionalNumber(form.servings),
        prepMinutes: toOptionalNumber(form.prepMinutes),
        cookMinutes: toOptionalNumber(form.cookMinutes),
        difficulty: form.difficulty === '' ? null : form.difficulty,
        cuisine: form.cuisine.trim(),
      };

      const saved =
        isEditing && recipeToEdit
          ? await updateRecipe.mutateAsync({ id: recipeToEdit._id, input })
          : await createRecipe.mutateAsync(input);

      toast.success(isEditing ? 'Recipe updated.' : 'Recipe added.');
      onSaved(saved);
    } catch (error) {
      if (error instanceof ApiError) {
        const messages = error.fieldMessages.length > 0 ? error.fieldMessages : [error.message];
        setErrors(messages);
      } else {
        setErrors([(error as Error).message || 'Could not save the recipe.']);
      }
    }
  };

  const currentImage = imagePreview ?? form.image;

  /**
   * Asks the assistant to tidy what is currently in the form.
   *
   * Deliberately sends the *live* form state rather than anything saved: the
   * whole point is to run it on rough notes before they are worth keeping.
   */
  const handleTidy = async () => {
    setErrors([]);
    try {
      const result = await tidy.mutateAsync({
        title: form.title,
        overview: form.overview,
        ingredients: ingredients.filter((i) => `${i.amount}${i.name}`.trim() !== ''),
        instructions: form.instructions,
      });
      setProposal(result);
    } catch (error) {
      setErrors([
        error instanceof ApiError
          ? error.message
          : 'The writing assistant could not be reached. Your recipe is untouched.',
      ]);
    }
  };

  /**
   * Applies only what the author ticked in the review.
   *
   * Every field is written back through the same setters the keyboard uses, so
   * a tidied recipe is in no way distinguishable from a typed one afterwards —
   * including being editable, and including still needing to be saved.
   */
  const applyTidy = (accepted: AcceptedTidy) => {
    setForm((current) => ({
      ...current,
      title: accepted.title || current.title,
      overview: accepted.overview || current.overview,
      instructions: accepted.instructions,
      cuisine: accepted.suggestions.cuisine ?? current.cuisine,
      difficulty: accepted.suggestions.difficulty ?? current.difficulty,
      servings: accepted.suggestions.servings?.toString() ?? current.servings,
      prepMinutes: accepted.suggestions.prepMinutes?.toString() ?? current.prepMinutes,
      cookMinutes: accepted.suggestions.cookMinutes?.toString() ?? current.cookMinutes,
      // Merged rather than replaced: the author's own tags are theirs, and an
      // accepted guess should add to them, not overwrite them.
      tags: accepted.suggestions.tags
        ? mergeTags(current.tags, accepted.suggestions.tags)
        : current.tags,
    }));

    setIngredients(accepted.ingredients.length > 0 ? accepted.ingredients : [EMPTY_INGREDIENT]);
    setProposal(null);
    toast.success('Tidied version applied. Check it over, then save.');
  };

  return (
    <form onSubmit={handleSubmit} className="recipe-form" noValidate>
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

      {!isEditing && (
        <ImportRecipe
          onImported={(imported) => {
            setForm({
              title: imported.title,
              overview: imported.overview,
              tags: imported.tags.join(', '),
              instructions: imported.instructions,
              image: imported.image,
              servings: imported.servings?.toString() ?? '',
              prepMinutes: imported.prepMinutes?.toString() ?? '',
              cookMinutes: imported.cookMinutes?.toString() ?? '',
              difficulty: '',
              cuisine: imported.cuisine,
            });
            setIngredients(
              imported.ingredients.length > 0 ? imported.ingredients : [EMPTY_INGREDIENT],
            );
            setErrors([]);
          }}
        />
      )}

      {aiAvailable && (
        <div className="tidy-launcher">
          <div className="tidy-launcher-text">
            <p className="tidy-launcher-title">Written it roughly?</p>
            <p className="tidy-launcher-hint">
              Type it however you like — the assistant will split it into steps and separate the
              amounts. It never adds a quantity you did not write.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary tidy-button"
            onClick={handleTidy}
            disabled={tidy.isPending}
          >
            <Icon name="sparkles" size={16} aria-hidden="true" />
            {tidy.isPending ? 'Tidying…' : 'Tidy up'}
          </button>
        </div>
      )}

      <div className="field">
        <label htmlFor="recipe-title">Title</label>
        <input
          id="recipe-title"
          value={form.title}
          onChange={(event) => updateField('title', event.target.value)}
          placeholder="Grandma's lemon cake"
          maxLength={140}
          required
        />
      </div>

      <div className="field">
        <label htmlFor="recipe-overview">Overview</label>
        <textarea
          id="recipe-overview"
          value={form.overview}
          onChange={(event) => updateField('overview', event.target.value)}
          placeholder="A short description of the dish"
          maxLength={500}
          rows={3}
          required
        />
        <span className="field-hint">{form.overview.length}/500</span>
      </div>

      <fieldset className="field">
        <legend>Image</legend>

        {currentImage && (
          <div className="image-preview">
            <img src={currentImage} alt="Recipe preview" referrerPolicy="no-referrer" />
            <button type="button" onClick={clearImage} className="btn-secondary btn-sm">
              <Icon name="close" size={14} />
              <span>Remove image</span>
            </button>
          </div>
        )}

        <div className="field">
          <label htmlFor="recipe-image-file">Upload a photo</label>
          <input
            id="recipe-image-file"
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
          />
          <span className="field-hint">JPEG, PNG, WebP or GIF, up to 10&nbsp;MB.</span>
        </div>

        <div className="field">
          <label htmlFor="recipe-image-url">Or paste an image URL</label>
          <input
            id="recipe-image-url"
            type="url"
            value={imageFile ? '' : form.image}
            disabled={Boolean(imageFile)}
            onChange={(event) => updateField('image', event.target.value)}
            placeholder="https://res.cloudinary.com/…"
          />
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>Details</legend>
        <p className="field-hint">
          All optional, but a recipe that says how long it takes and how many it feeds is far
          more useful — and these power the time and difficulty filters.
        </p>

        <div className="field-grid">
          <div className="field">
            <label htmlFor="recipe-servings">Servings</label>
            <input
              id="recipe-servings"
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              value={form.servings}
              onChange={(event) => updateField('servings', event.target.value)}
              placeholder="4"
            />
          </div>

          <div className="field">
            <label htmlFor="recipe-prep">Prep time (minutes)</label>
            <input
              id="recipe-prep"
              type="number"
              inputMode="numeric"
              min={0}
              max={1440}
              value={form.prepMinutes}
              onChange={(event) => updateField('prepMinutes', event.target.value)}
              placeholder="15"
            />
          </div>

          <div className="field">
            <label htmlFor="recipe-cook">Cook time (minutes)</label>
            <input
              id="recipe-cook"
              type="number"
              inputMode="numeric"
              min={0}
              max={1440}
              value={form.cookMinutes}
              onChange={(event) => updateField('cookMinutes', event.target.value)}
              placeholder="30"
            />
          </div>

          <div className="field">
            <label htmlFor="recipe-difficulty">Difficulty</label>
            <select
              id="recipe-difficulty"
              value={form.difficulty}
              onChange={(event) => updateField('difficulty', event.target.value as Difficulty | '')}
            >
              <option value="">Not stated</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="recipe-cuisine">Cuisine</label>
            <input
              id="recipe-cuisine"
              value={form.cuisine}
              onChange={(event) => updateField('cuisine', event.target.value)}
              maxLength={40}
              placeholder="Pakistani"
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>Ingredients</legend>
        <div className="ingredients-list">
          {ingredients.map((ingredient, index) => (
            <div className="ingredient-field" key={index}>
              <input
                aria-label={`Amount for ingredient ${index + 1}`}
                placeholder="1 cup"
                value={ingredient.amount}
                maxLength={60}
                onChange={(event) => updateIngredient(index, 'amount', event.target.value)}
                className="ingredient-amount"
              />
              <input
                aria-label={`Name of ingredient ${index + 1}`}
                placeholder="Plain flour"
                value={ingredient.name}
                maxLength={120}
                onChange={(event) => updateIngredient(index, 'name', event.target.value)}
                className="ingredient-name"
              />
              {ingredients.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeIngredient(index)}
                  className="remove-ingredient-btn"
                  aria-label={`Remove ingredient ${index + 1}`}
                >
                  <Icon name="close" size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={addIngredient} className="add-ingredient-btn">
          <Icon name="plus" size={16} />
          <span>Add ingredient</span>
        </button>
      </fieldset>

      <div className="field">
        <label htmlFor="recipe-instructions" id="instructions-label">
          Instructions
        </label>
        <RichTextEditor
          content={form.instructions}
          onChange={(html) => updateField('instructions', html)}
          placeholder="Write the steps…"
          ariaLabel="Recipe instructions"
        />
      </div>

      <div className="field">
        <label htmlFor="recipe-tags">Tags</label>
        <input
          id="recipe-tags"
          value={form.tags}
          onChange={(event) => updateField('tags', event.target.value)}
          placeholder="dessert, quick, vegan"
        />
        <span className="field-hint">Separate with commas. Up to 12 tags.</span>
      </div>

      <div className="form-actions">
        <button type="button" onClick={onCancel} className="btn-secondary" disabled={isSaving}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={isSaving}>
          {isUploading ? 'Uploading image…' : isSaving ? 'Saving…' : isEditing ? 'Update recipe' : 'Add recipe'}
        </button>
      </div>

      <TidyReview
        isOpen={proposal !== null}
        proposal={proposal}
        current={{ ingredients, instructions: form.instructions }}
        onClose={() => setProposal(null)}
        onApply={applyTidy}
      />
    </form>
  );
}

/** Adds accepted tags to the author's own, without duplicating or reordering. */
function mergeTags(existing: string, added: string[]): string {
  const current = existing
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

  const seen = new Set(current.map((tag) => tag.toLowerCase()));
  const merged = [...current];

  for (const tag of added) {
    if (seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    merged.push(tag);
  }

  return merged.slice(0, 12).join(', ');
}
