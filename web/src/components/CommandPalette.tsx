import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useRecipeEditor } from '../context/RecipeEditorContext';
import { useOverlay } from '../context/OverlayContext';
import { api } from '../lib/api';
import type { RecipeSummary } from '../types';

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: IconName;
  run: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * ⌘K search and navigation.
 *
 * Implemented as a `combobox` driving a `listbox`, with the active option
 * pointed at by `aria-activedescendant` rather than by moving DOM focus — focus
 * has to stay in the text field so typing keeps working while the arrow keys
 * move the selection.
 */
export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RecipeSummary[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const navigate = useNavigate();
  const { user } = useAuth();
  const { toggle: toggleTheme } = useTheme();
  const { openCreate } = useRecipeEditor();

  useOverlay(isOpen);

  const go = (path: string) => {
    navigate(path);
    onClose();
  };

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      { id: 'home', label: 'All recipes', icon: 'book', run: () => go('/') },
      { id: 'list', label: 'Shopping list', icon: 'cart', run: () => go('/shopping-list') },
      {
        id: 'theme',
        label: 'Toggle light or dark theme',
        icon: 'moon',
        run: () => {
          toggleTheme();
          onClose();
        },
      },
    ];

    if (user) {
      base.splice(
        1,
        0,
        { id: 'saved', label: 'Saved recipes', icon: 'star', run: () => go('/saved-recipes') },
        { id: 'profile', label: 'My profile', icon: 'user', run: () => go(`/profile/${user.uid}`) },
        {
          id: 'new',
          label: 'Add a recipe',
          icon: 'plus',
          run: () => {
            openCreate();
            onClose();
          },
        },
      );
    } else {
      base.push({ id: 'login', label: 'Log in', icon: 'user', run: () => go('/login') });
    }

    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, toggleTheme, openCreate]);

  const matchingCommands = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((command) => command.label.toLowerCase().includes(needle));
  }, [commands, query]);

  // Search runs only for queries worth a round trip, debounced.
  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const found = await api.recipes.list({ search: needle, limit: 6 }, controller.signal);
        setResults(found.items);
      } catch {
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 220);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => setActiveIndex(0), [query]);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setResults([]);
      return;
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [isOpen]);

  // Flattened so the arrow keys traverse commands and recipes as one list.
  const options = useMemo(
    () => [
      ...matchingCommands.map((command) => ({ kind: 'command' as const, command })),
      ...results.map((recipe) => ({ kind: 'recipe' as const, recipe })),
    ],
    [matchingCommands, results],
  );

  useEffect(() => {
    listRef.current
      ?.querySelector(`#palette-option-${activeIndex}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!isOpen) return null;

  const select = (index: number) => {
    const option = options[index];
    if (!option) return;
    if (option.kind === 'command') option.command.run();
    else go(`/recipe/${option.recipe._id}`);
  };

  return createPortal(
    <div
      className="palette-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-input-row">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            type="text"
            className="palette-input"
            placeholder="Search recipes or jump to…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={options.length > 0 ? `palette-option-${activeIndex}` : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((current) => (current + 1) % Math.max(1, options.length));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((current) => (current - 1 + options.length) % Math.max(1, options.length));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                select(activeIndex);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              }
            }}
          />
          <kbd className="palette-esc">esc</kbd>
        </div>

        <ul className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {options.length === 0 && (
            <li className="palette-empty" role="presentation">
              {isSearching ? 'Searching…' : 'No matches.'}
            </li>
          )}

          {options.map((option, index) => {
            const active = index === activeIndex;
            return (
              <li
                key={option.kind === 'command' ? option.command.id : option.recipe._id}
                id={`palette-option-${index}`}
                role="option"
                aria-selected={active}
                className={`palette-option ${active ? 'is-active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => select(index)}
              >
                {option.kind === 'command' ? (
                  <>
                    <Icon name={option.command.icon} size={16} />
                    <span className="palette-label">{option.command.label}</span>
                    <span className="palette-kind">Action</span>
                  </>
                ) : (
                  <>
                    <Icon name="book" size={16} />
                    <span className="palette-label">{option.recipe.title}</span>
                    <span className="palette-kind">Recipe</span>
                  </>
                )}
              </li>
            );
          })}
        </ul>

        <footer className="palette-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>?</kbd> all shortcuts
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
