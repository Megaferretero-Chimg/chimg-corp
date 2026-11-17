import FloatingModal from "@/components/ui/FloatingModal";
import LessonContent from "@/modules/academy/components/LessonContent";

export default function LessonPreview({ title, blocks, previewSources, previewUrls, onClose }) {
  return (
    <FloatingModal isOpen isFullscreen title={title || "Vista previa"} onClose={onClose}>
      <LessonContent blocks={blocks} previewSources={previewSources} previewUrls={previewUrls} focusOnMount />
    </FloatingModal>
  );
}
