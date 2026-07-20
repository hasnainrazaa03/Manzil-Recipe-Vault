import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { Icon } from '../components/Icon';
import { EmptyState } from '../components/EmptyState';
import { useShoppingList } from '../hooks/useShoppingList';
import { pluralise } from '../lib/format';

export default function ShoppingListPage() {
  const { grouped, count, remaining, toggle, remove, removeRecipe, clearChecked, clearAll } =
    useShoppingList();

  const copyToClipboard = async () => {
    const text = grouped
      .map(
        (group) =>
          `${group.recipeTitle}\n` +
          group.items.map((item) => `  - ${item.amount} ${item.name}`.trim()).join('\n'),
      )
      .join('\n\n');

    try {
      await navigator.clipboard.writeText(text);
      toast.success('Shopping list copied.');
    } catch {
      toast.error('Could not copy the list.');
    }
  };

  if (count === 0) {
    return (
      <div className="shopping-list-page">
        <h1>Shopping list</h1>
        <EmptyState
          icon="cart"
          title="Your shopping list is empty"
          message="Open a recipe and choose “Add to list” to collect its ingredients here."
          action={
            <Link to="/" className="btn-primary">
              Browse recipes
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="shopping-list-page">
      <header className="section-header">
        <div>
          <h1>Shopping list</h1>
          <p className="field-hint">
            {remaining === 0
              ? 'Everything is ticked off.'
              : `${pluralise(remaining, 'item')} left of ${count}.`}
          </p>
        </div>

        <div className="shopping-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={copyToClipboard}>
            <Icon name="share" size={15} />
            <span>Copy</span>
          </button>
          <button type="button" className="btn-secondary btn-sm" onClick={() => window.print()}>
            <Icon name="printer" size={15} />
            <span>Print</span>
          </button>
          {count > remaining && (
            <button type="button" className="btn-secondary btn-sm" onClick={clearChecked}>
              Clear ticked
            </button>
          )}
          <button type="button" className="btn-danger btn-sm" onClick={clearAll}>
            Clear all
          </button>
        </div>
      </header>

      {/* Grouped by recipe, because that is how the list was built and how you
          undo a decision — "I'm not making that after all" removes a block. */}
      {grouped.map((group) => (
        <section key={group.recipeId} className="shopping-group">
          <div className="shopping-group-header">
            <h2>
              <Link to={`/recipe/${group.recipeId}`}>{group.recipeTitle}</Link>
            </h2>
            <button
              type="button"
              className="btn-link btn-sm btn-link--danger"
              onClick={() => removeRecipe(group.recipeId)}
            >
              Remove recipe
            </button>
          </div>

          <ul className="shopping-items">
            {group.items.map((item) => (
              <li key={item.id} className={item.checked ? 'is-checked' : ''}>
                <label className="ingredient-check">
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={() => toggle(item.id)}
                    aria-label={`${item.amount} ${item.name}`.trim()}
                  />
                  <span className="ingredient-check-box" aria-hidden="true">
                    <Icon name="check" size={14} />
                  </span>
                  <span className="ingredient-text">
                    {item.amount && <span className="ingredient-amount">{item.amount}</span>}
                    <span className="ingredient-name">{item.name}</span>
                  </span>
                </label>

                <button
                  type="button"
                  className="shopping-remove"
                  onClick={() => remove(item.id)}
                  aria-label={`Remove ${item.name}`}
                >
                  <Icon name="close" size={15} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
