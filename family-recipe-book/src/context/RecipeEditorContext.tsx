import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'react-toastify';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useDeleteRecipe } from '../lib/queries';
import { ApiError } from '../lib/api';
import type { RecipeDetail, RecipeSummary } from '../types';

interface RecipeEditorContextValue {
  openCreate: () => void;
  openEdit: (recipe: RecipeDetail) => void;
  confirmDelete: (recipe: RecipeSummary | RecipeDetail, onDeleted?: () => void) => void;
}

const RecipeEditorContext = createContext<RecipeEditorContextValue | null>(null);

/**
 * The form pulls in Tiptap and ProseMirror — the largest dependency in the app,
 * and one that most visitors never need. Loading it when the dialog opens keeps
 * it out of the initial bundle entirely.
 */
const RecipeForm = lazy(() =>
  import('../components/RecipeForm').then((module) => ({ default: module.RecipeForm })),
);

/**
 * Owns the create/edit dialog and the delete confirmation so that any page can
 * trigger them without the previous arrangement, where both lived in the root
 * component and eight callbacks were threaded down through every page.
 */
export function RecipeEditorProvider({ children }: { children: ReactNode }) {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<RecipeDetail | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    recipe: RecipeSummary | RecipeDetail;
    onDeleted?: () => void;
  } | null>(null);

  const deleteRecipe = useDeleteRecipe();

  const closeForm = useCallback(() => {
    setIsFormOpen(false);
    setEditing(null);
  }, []);

  const value = useMemo<RecipeEditorContextValue>(
    () => ({
      openCreate: () => {
        setEditing(null);
        setIsFormOpen(true);
      },
      openEdit: (recipe) => {
        setEditing(recipe);
        setIsFormOpen(true);
      },
      confirmDelete: (recipe, onDeleted) => setPendingDelete({ recipe, onDeleted }),
    }),
    [],
  );

  const runDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteRecipe.mutateAsync(pendingDelete.recipe._id);
      toast.success('Recipe deleted.');
      pendingDelete.onDeleted?.();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not delete the recipe.');
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <RecipeEditorContext.Provider value={value}>
      {children}

      <Modal
        isOpen={isFormOpen}
        onClose={closeForm}
        title={editing ? 'Edit recipe' : 'Add a new recipe'}
        size="wide"
      >
        <Suspense
          fallback={
            <div className="loading-container">
              <div className="spinner" />
              <p>Loading editor…</p>
            </div>
          }
        >
          <RecipeForm recipeToEdit={editing} onSaved={closeForm} onCancel={closeForm} />
        </Suspense>
      </Modal>

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title="Delete recipe"
        message={
          pendingDelete
            ? `"${pendingDelete.recipe.title}" will be permanently deleted, along with its comments and ratings. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete recipe"
        isDestructive
        isPending={deleteRecipe.isPending}
        onConfirm={runDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </RecipeEditorContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRecipeEditor(): RecipeEditorContextValue {
  const context = useContext(RecipeEditorContext);
  if (!context) throw new Error('useRecipeEditor must be used within a RecipeEditorProvider');
  return context;
}
