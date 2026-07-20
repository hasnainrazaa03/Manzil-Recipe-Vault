import { useAuth } from '../context/AuthContext';
import { useRecipeEditor } from '../context/RecipeEditorContext';
import { Icon } from './Icon';

export function AddRecipeButton() {
  const { user } = useAuth();
  const { openCreate } = useRecipeEditor();

  if (!user) return null;

  return (
    <button type="button" onClick={openCreate} className="floating-add-btn">
      <Icon name="plus" size={20} className="plus-icon" />
      <span className="text">Add recipe</span>
    </button>
  );
}
