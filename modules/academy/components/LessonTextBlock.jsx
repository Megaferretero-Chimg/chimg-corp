import { Heading, Heading2, List, ListOrdered, Pilcrow } from "lucide-react";
import { useEffect, useRef } from "react";

import styles from "@/modules/academy/styles/admin.module.scss";

const formats = [
  { style: "paragraph", tag: "p", label: "Párrafo", Icon: Pilcrow, command: "formatBlock" },
  { style: "heading", tag: "h2", label: "Título", Icon: Heading, command: "formatBlock" },
  { style: "subheading", tag: "h3", label: "Subtítulo", Icon: Heading2, command: "formatBlock" },
  { style: "bullets", tag: "ul", label: "Viñetas", Icon: List, command: "insertUnorderedList" },
  { style: "numbered", tag: "ol", label: "Lista numerada", Icon: ListOrdered, command: "insertOrderedList" },
];

export default function LessonTextBlock({ parts, onChange, disabled }) {
  const editorRef = useRef(null);
  const initialParts = useRef(parts);
  const selectionRef = useRef(null);

  useEffect(() => {
    const editor = editorRef.current;
    const nodes = initialParts.current.map(({ style, text }) => {
      const tag = formats.find((format) => format.style === style)?.tag ?? "p";
      const node = document.createElement(tag);
      if (tag === "ul" || tag === "ol") {
        for (const line of text.split("\n")) {
          const item = document.createElement("li");
          item.textContent = line;
          node.append(item);
        }
      } else {
        node.textContent = text;
      }
      return node;
    });
    editor.replaceChildren(...nodes);
  }, []);

  function rememberSelection() {
    const selection = window.getSelection();
    if (selection?.rangeCount && editorRef.current.contains(selection.anchorNode) && editorRef.current.contains(selection.focusNode)) {
      selectionRef.current = selection.getRangeAt(0).cloneRange();
    }
  }

  function publishContent() {
    const editor = editorRef.current;
    const parts = Array.from(editor.childNodes).map((node) => {
      const style = formats.find(({ tag }) => tag.toUpperCase() === node.nodeName)?.style ?? "paragraph";
      const text = style === "bullets" || style === "numbered"
        ? Array.from(node.children).map((item) => item.innerText).join("\n")
        : node.innerText ?? node.textContent ?? "";
      return { style, text };
    });
    onChange(parts);
    rememberSelection();
  }

  function applyFormat(command, tag) {
    const editor = editorRef.current;
    editor.focus();
    const range = selectionRef.current;
    if (range && editor.contains(range.commonAncestorContainer)) {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    document.execCommand(command, false, command === "formatBlock" ? tag : undefined);
    publishContent();
  }

  return (
    <div className={styles.richText}>
      <div className={styles.richTextToolbar} role="group" aria-label="Formato del texto">
        {formats.map(({ style, tag, label, Icon, command }) => (
          <button
            key={style}
            type="button"
            className={styles.lessonAction}
            aria-label={label}
            title={label}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applyFormat(command, tag)}
          >
            <Icon size={18} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div
        ref={editorRef}
        className={styles.richTextSurface}
        contentEditable={!disabled}
        role="textbox"
        aria-label="Texto de la lección"
        aria-multiline="true"
        aria-readonly={disabled}
        onInput={publishContent}
        onBlur={rememberSelection}
        onMouseUp={rememberSelection}
        onKeyUp={rememberSelection}
        onDrop={(event) => event.preventDefault()}
        onPaste={(event) => {
          event.preventDefault();
          document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
          publishContent();
        }}
      />
    </div>
  );
}
