import { useEffect, useRef } from "react";

import FloatingModal from "@/components/ui/FloatingModal";
import LessonMediaPreview from "@/modules/academy/components/LessonMediaPreview";
import styles from "@/modules/academy/styles/lesson-preview.module.scss";

function TextPart({ style, text }) {
  if (style === "heading") return <h2>{text}</h2>;
  if (style === "subheading") return <h3>{text}</h3>;
  if (style === "bullets" || style === "numbered") {
    const List = style === "numbered" ? "ol" : "ul";
    return (
      <List>
        {text.split("\n").filter((line) => line.trim()).map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </List>
    );
  }
  return <p>{text}</p>;
}

function LessonPreviewContent({ blocks, previewSources, previewUrls }) {
  const content = useRef(null);

  useEffect(() => {
    content.current?.focus();
  }, []);

  const visibleBlocks = blocks.filter((block) => {
    if (block.kind === "divider") return true;
    if (block.kind === "text") return block.parts.some(({ text }) => text.trim());
    return block.assets.length > 0;
  });

  return (
    <article className={styles.lesson} tabIndex={-1} ref={content} aria-label="Contenido de la lección">
      {visibleBlocks.length === 0 && <p className={styles.empty}>La lección todavía está vacía.</p>}
      {visibleBlocks.map((block) => {
        if (block.kind === "divider") return <hr key={block.key} className={styles.divider} />;
        if (block.kind === "text") {
          return (
            <div key={block.key} className={styles.text}>
              {block.parts.map((part, index) => <TextPart key={index} {...part} />)}
            </div>
          );
        }

        return (
          <div key={block.key} className={block.kind === "image" ? styles.images : styles.videos}>
            {block.assets.map((asset, index) => {
              const src = previewSources[asset.publicId] ?? previewUrls[asset.publicId];
              const label = asset.kind === "image" ? "Imagen" : "Video";
              return <LessonMediaPreview key={`${asset.publicId}-${index}-${src}`} asset={asset} src={src} label={`${label} ${index + 1}`} />;
            })}
          </div>
        );
      })}
    </article>
  );
}

export default function LessonPreview({ title, blocks, previewSources, previewUrls, onClose }) {
  return (
    <FloatingModal isOpen isFullscreen title={title || "Vista previa"} onClose={onClose}>
      <LessonPreviewContent blocks={blocks} previewSources={previewSources} previewUrls={previewUrls} />
    </FloatingModal>
  );
}
