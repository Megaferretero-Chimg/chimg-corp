import Image from "next/image";
import { useState } from "react";

import styles from "@/modules/academy/styles/admin.module.scss";

export default function LessonMediaPreview({ asset, src, label }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return <p className={styles.autoSaveStatus}>Vista previa no disponible · {asset.format?.toUpperCase()}</p>;
  }

  if (asset.kind === "video") {
    return (
      <video
        className={styles.mediaPreview}
        src={src}
        aria-label={label || "Video de la lección"}
        controls
        playsInline
        preload="metadata"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <Image
      className={styles.mediaPreview}
      src={src}
      alt={label || "Imagen de la lección"}
      width={960}
      height={540}
      unoptimized
      onError={() => setFailed(true)}
    />
  );
}
