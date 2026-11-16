import { ImagePlus, Video, X } from "lucide-react";
import { useRef, useState } from "react";

import LessonMediaPreview from "@/modules/academy/components/LessonMediaPreview";
import { MAX_LESSON_BLOCK_IMAGES } from "@/modules/academy/module";
import styles from "@/modules/academy/styles/admin.module.scss";

export default function LessonMediaBlock({ kind, assets, label, disabled, previewUrls, previewSources, onFiles, onRemove, maxImages = MAX_LESSON_BLOCK_IMAGES }) {
  const input = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const isVideo = kind === "video";
  const full = !isVideo && assets.length >= maxImages;
  const AddIcon = isVideo ? Video : ImagePlus;
  const mediaName = isVideo ? "video" : "imagen";

  return (
    <div className={styles.imageBlock}>
      {assets.length > 0 && (
        <ul className={styles.imageGrid} data-video={isVideo}>
          {assets.map((asset, index) => {
            const src = previewSources[asset.publicId] ?? previewUrls[asset.publicId];
            return (
              <li key={asset.publicId}>
                <LessonMediaPreview key={src} asset={asset} src={src} label={label ? `${label}, ${mediaName} ${index + 1}` : `${isVideo ? "Video" : "Imagen"} ${index + 1}`} />
                <button type="button" className={styles.imageRemove} aria-label={`Quitar ${mediaName} ${index + 1}`} title={`Quitar ${mediaName}`} disabled={disabled} onClick={() => onRemove(asset.publicId)}>
                  <X size={16} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <input ref={input} type="file" hidden multiple accept={`${kind}/*`} disabled={disabled || full} onChange={(event) => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = "";
        onFiles(files);
      }} />
      <div className={styles.imageDropZone} data-drag-over={dragOver && !disabled && !full} onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled || full ? "none" : "copy";
        setDragOver(true);
      }} onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setDragOver(false);
      }} onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        if (!disabled && !full) onFiles(Array.from(event.dataTransfer.files));
      }}>
        <button type="button" disabled={disabled || full} onClick={() => input.current?.click()}>
          <AddIcon size={22} aria-hidden="true" />
          {full ? "Límite alcanzado" : isVideo ? "Arrastra videos o haz clic para seleccionarlos" : "Arrastra imágenes o haz clic para seleccionarlas"}
        </button>
        {!isVideo && <span>{assets.length} de {maxImages} imágenes</span>}
      </div>
    </div>
  );
}
