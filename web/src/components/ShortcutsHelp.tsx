import { Modal } from './Modal';

const SHORTCUTS: { keys: string[]; description: string }[] = [
  { keys: ['⌘', 'K'], description: 'Open the command palette' },
  { keys: ['/'], description: 'Focus the search box' },
  { keys: ['G', 'H'], description: 'Go to all recipes' },
  { keys: ['G', 'S'], description: 'Go to saved recipes' },
  { keys: ['G', 'L'], description: 'Go to the shopping list' },
  { keys: ['N'], description: 'Add a new recipe' },
  { keys: ['?'], description: 'Show this list' },
  { keys: ['Esc'], description: 'Close whatever is open' },
];

export function ShortcutsHelp({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Keyboard shortcuts">
      <dl className="shortcut-list">
        {SHORTCUTS.map((shortcut) => (
          <div className="shortcut-row" key={shortcut.description}>
            <dt>
              {shortcut.keys.map((key) => (
                <kbd key={key}>{key}</kbd>
              ))}
            </dt>
            <dd>{shortcut.description}</dd>
          </div>
        ))}
      </dl>
      <p className="field-hint">
        Letter shortcuts are ignored while you are typing in a field, so they never swallow text.
      </p>
    </Modal>
  );
}
