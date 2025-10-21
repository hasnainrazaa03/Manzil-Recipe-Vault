import React from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

// Basic Toolbar Component (Optional but recommended)
const MenuBar = ({ editor }) => {
  if (!editor) {
    return null;
  }

  return (
    <div className="editor-toolbar">
      <button
        type="button" // Important for preventing form submission
        onClick={() => editor.chain().focus().toggleBold().run()}
        disabled={!editor.can().chain().focus().toggleBold().run()}
        className={editor.isActive('bold') ? 'is-active' : ''}
      >
        Bold
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        disabled={!editor.can().chain().focus().toggleItalic().run()}
        className={editor.isActive('italic') ? 'is-active' : ''}
      >
        Italic
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        disabled={!editor.can().chain().focus().toggleStrike().run()}
        className={editor.isActive('strike') ? 'is-active' : ''}
      >
        Strike
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().setParagraph().run()}
        className={editor.isActive('paragraph') ? 'is-active' : ''}
      >
        Paragraph
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={editor.isActive('bulletList') ? 'is-active' : ''}
      >
        Bullet list
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={editor.isActive('orderedList') ? 'is-active' : ''}
      >
        Ordered list
      </button>
       {/* Add more buttons for other StarterKit features if desired */}
    </div>
  );
};

// The main Editor Component
function RichTextEditor({ content, onChange, placeholder }) {
  const editor = useEditor({
    extensions: [
      StarterKit, // Use the basic extension bundle
    ],
    content: content || '', // Initial content from props
    // Trigger the onChange prop whenever the editor content changes
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    // Define editor props, like placeholder text
    editorProps: {
      attributes: {
        class: 'tiptap-editor', // Class for styling the editor area
      },
    },
  });

  // Set placeholder using CSS pseudo-element
  const placeholderStyle = `
    .tiptap-editor p.is-editor-empty:first-child::before {
      content: attr(data-placeholder);
      float: left;
      color: #adb5bd;
      pointer-events: none;
      height: 0;
    }
  `;

  return (
    <div className="tiptap-wrapper">
      <style>{placeholderStyle}</style>
      <MenuBar editor={editor} />
      <EditorContent editor={editor} data-placeholder={placeholder || 'Write something...'}/>
    </div>
  );
}

export default RichTextEditor;