import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { prefetchRecipeForm, useRecipeEditor } from '../context/RecipeEditorContext';
import { Icon } from './Icon';

export function AddRecipeButton() {
  const { user } = useAuth();
  const { openCreate } = useRecipeEditor();

  /**
   * Signing in is the strongest signal anyone will open the editor, so the
   * download starts then — during idle time, long before the button is pressed.
   * Pointer and focus are a second chance for the case where idle time never
   * came, and by then the intent is unmistakable.
   */
  useEffect(() => {
    if (user) prefetchRecipeForm();
  }, [user]);

  if (!user) return null;

  return (
    <button
      type="button"
      onClick={openCreate}
      onPointerEnter={prefetchRecipeForm}
      onFocus={prefetchRecipeForm}
      className="floating-add-btn"
    >
      <Icon name="plus" size={20} className="plus-icon" />
      <span className="text">Add recipe</span>
    </button>
  );
}
