import React, { useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

function RichTextEditor({ content, onChange, placeholder }) {
    
    const MenuBar = ({ editor }) => {
      if (!editor) {
        return null;
      }

      return (
        <div className="editor-toolbar">
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={editor.isActive('bold') ? 'is-active' : ''}
            title="Bold"
          >
            <i className="fa fa-bold"></i>
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={editor.isActive('italic') ? 'is-active' : ''}
            title="Italic"
          >
            <i className="fa fa-italic"></i>
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleStrike().run()}
            className={editor.isActive('strike') ? 'is-active' : ''}
            title="Strike"
          >
            <i className="fa fa-strikethrough"></i>
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().setParagraph().run()}
            title="Paragraph"
          >
            <i className="fa fa-paragraph"></i>
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={editor.isActive('bulletList') ? 'is-active' : ''}
            title="Bullet List"
          >
            <i className="fa fa-list-ul"></i>
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={editor.isActive('orderedList') ? 'is-active' : ''}
            title="Ordered List"
          >
            <i className="fa fa-list-ol"></i>
          </button>
        </div>
      );
    };
    
    const [_, setForceUpdate] = useState(0);

    const editor = useEditor({
      extensions: [
        StarterKit,
      ],
      content: content || '', 
      onUpdate: ({ editor }) => {
        onChange(editor.getHTML());
      },
      
      onTransaction: () => {
        setForceUpdate(val => val + 1);
      },

      editorProps: {
        attributes: {
          class: 'tiptap-editor', 
        },
      },
    });

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