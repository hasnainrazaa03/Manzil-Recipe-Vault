import { useEffect, useRef } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Icon, type IconName } from './Icon';

interface ToolbarButton {
  name: string;
  icon: IconName;
  label: string;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

const BUTTONS: ToolbarButton[] = [
  { name: 'bold', icon: 'bold', label: 'Bold', isActive: (e) => e.isActive('bold'), run: (e) => e.chain().focus().toggleBold().run() },
  { name: 'italic', icon: 'italic', label: 'Italic', isActive: (e) => e.isActive('italic'), run: (e) => e.chain().focus().toggleItalic().run() },
  { name: 'strike', icon: 'strike', label: 'Strikethrough', isActive: (e) => e.isActive('strike'), run: (e) => e.chain().focus().toggleStrike().run() },
  { name: 'heading', icon: 'heading', label: 'Heading', isActive: (e) => e.isActive('heading', { level: 3 }), run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { name: 'bulletList', icon: 'list-ul', label: 'Bullet list', isActive: (e) => e.isActive('bulletList'), run: (e) => e.chain().focus().toggleBulletList().run() },
  { name: 'orderedList', icon: 'list-ol', label: 'Numbered list', isActive: (e) => e.isActive('orderedList'), run: (e) => e.chain().focus().toggleOrderedList().run() },
  { name: 'blockquote', icon: 'quote', label: 'Quote', isActive: (e) => e.isActive('blockquote'), run: (e) => e.chain().focus().toggleBlockquote().run() },
];

function Toolbar({ editor }: { editor: Editor }) {
  return (
    <div className="editor-toolbar" role="toolbar" aria-label="Text formatting">
      {BUTTONS.map((button) => {
        const active = button.isActive(editor);
        return (
          <button
            key={button.name}
            type="button"
            // `aria-pressed` conveys the on/off state that the previous version
            // expressed only through a CSS class.
            aria-pressed={active}
            aria-label={button.label}
            title={button.label}
            className={active ? 'is-active' : ''}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => button.run(editor)}
          >
            <Icon name={button.icon} size={17} />
          </button>
        );
      })}
    </div>
  );
}

interface RichTextEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}

export function RichTextEditor({
  content,
  onChange,
  placeholder = 'Write something…',
  ariaLabel = 'Recipe instructions',
}: RichTextEditorProps) {
  /**
   * Remembers the HTML this editor last emitted. Without it, the parent's state
   * update flows back into `setContent` on every keystroke, resetting the
   * document and throwing the cursor to the end — the cause of the editor's
   * cursor-jumping. Comparing against what we emitted means only a genuinely
   * external change (loading a recipe to edit, resetting the form) resyncs.
   */
  const lastEmitted = useRef(content);

  const editor = useEditor({
    extensions: [StarterKit],
    content,
    onUpdate: ({ editor: instance }) => {
      const html = instance.getHTML();
      lastEmitted.current = html;
      onChange(html);
    },
    editorProps: {
      attributes: {
        class: 'tiptap-editor',
        'aria-label': ariaLabel,
        'data-placeholder': placeholder,
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (content === lastEmitted.current) return;

    lastEmitted.current = content;
    // `emitUpdate: false` stops the resync from bouncing straight back out as
    // an onChange, which would loop.
    editor.commands.setContent(content || '', { emitUpdate: false });
  }, [content, editor]);

  return (
    <div className="tiptap-wrapper">
      {editor && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}
