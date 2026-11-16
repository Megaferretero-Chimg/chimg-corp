"use client";

import Link from "next/link";
import { ArrowLeft, Check, CloudCheck, CloudOff, CloudUpload, Eye, FileText, GripVertical, ImagePlus, Minus, Pencil, Trash2, Video } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import FloatingModal from "@/components/ui/FloatingModal";
import SelectInput from "@/components/ui/SelectInput";
import LessonMediaBlock from "@/modules/academy/components/LessonMediaBlock";
import LessonPreview from "@/modules/academy/components/LessonPreview";
import LessonTextBlock from "@/modules/academy/components/LessonTextBlock";
import { uploadAcademyMedia } from "@/modules/academy/lib/upload-media";
import { saveCourse } from "@/modules/academy/actions/save-course";
import { ACADEMY_COURSES_PATH, MAX_LESSON_BLOCK_IMAGES } from "@/modules/academy/module";
import styles from "@/modules/academy/styles/admin.module.scss";

const BLOCK_NAMES = { text: "Texto", image: "Imagen", video: "Video", divider: "Separador" };

function initialLessonBlocks(lesson) {
  const blocks = lesson?.blocks ?? [
    ...(lesson?.content ? [{ kind: "text", parts: [{ style: "paragraph", text: lesson.content }] }] : []),
    ...(lesson?.media ?? []).map((asset) => ({ kind: asset.kind, asset })),
  ];
  return blocks.map((block, index) => {
    const key = `saved-${index}`;
    if (block.kind !== "image" && block.kind !== "video") return { ...block, key };
    return { kind: block.kind, label: block.label, assets: block.assets ?? block.images ?? (block.asset ? [block.asset] : []), key };
  });
}

export default function CourseEditor({ course, chapter, lesson, section, roles = [], categories = [], previewUrls = {} }) {
  const router = useRouter();
  const courseHref = course ? `${ACADEMY_COURSES_PATH}?edit=${course._id}` : ACADEMY_COURSES_PATH;
  const chapterHref = chapter ? `${courseHref}&section=chapter&chapter=${chapter._id}` : courseHref;
  const isCreateModal = !course || (section === "chapter" && !chapter) || (section === "lesson" && !lesson);
  const closeCreateModal = useCallback(() => router.replace(section === "lesson" ? chapterHref : courseHref, { scroll: false }), [router, courseHref, chapterHref, section]);
  const [result, action, isPending] = useActionState(saveCourse, null);
  const [autoSaving, setAutoSaving] = useState(false);
  const [autoSaveResult, setAutoSaveResult] = useState(null);
  const [savedVersion, setSavedVersion] = useState(null);
  const [blockName, setBlockName] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewButton = useRef(null);
  const closePreview = useCallback(() => {
    setPreviewOpen(false);
    window.requestAnimationFrame(() => previewButton.current?.focus());
  }, []);
  const [editingTitle, setEditingTitle] = useState(false);
  const localPreviews = useRef(new Map());
  const [previewSources, setPreviewSources] = useState({});
  const uploadLock = useRef(false);
  const blockList = useRef(null);
  const drag = useRef(null);
  const pendingMove = useRef(null);
  const [draggingKey, setDraggingKey] = useState(null);
  const [reorderNotice, setReorderNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [removingBlock, setRemovingBlock] = useState(null);
  const busy = isPending || uploading || removingBlock !== null;
  const [draft, setDraft] = useState(() => {
    if (section === "lesson") {
      return { title: lesson?.title ?? "", blocks: initialLessonBlocks(lesson) };
    }
    if (section === "chapter") {
      return { title: chapter?.title ?? "" };
    }
    if (section === "settings") {
      return { status: course.status, roleIds: course.roleIds ?? [] };
    }
    return { title: course?.title ?? "", description: course?.description ?? "", type: course?.type ?? "onboarding" };
  });

  const draftPayload = JSON.stringify(draft);
  const [savedLesson, setSavedLesson] = useState(() => lesson ? draftPayload : null);
  const lessonChanged = Boolean(lesson && draftPayload !== savedLesson);
  const version = savedVersion ?? course?.__v ?? 0;
  const lessonId = lesson?._id;
  const courseId = course?._id;
  const chapterId = chapter?._id;
  const autoSaveError = autoSaveResult?.payload === draftPayload ? autoSaveResult.error : null;
  const autoSaveStatus = autoSaving ? "Guardando cambios" : lessonChanged ? "Cambios pendientes" : "Cambios guardados";

  useEffect(() => {
    if (!lessonChanged || autoSaving || autoSaveError || busy || draggingKey || !draft.title.trim()) return;

    const timer = window.setTimeout(async () => {
      const fields = new FormData();
      fields.set("id", courseId);
      fields.set("version", String(version));
      fields.set("section", "lesson");
      fields.set("chapter", chapterId);
      fields.set("lesson", lessonId);
      fields.set("course", draftPayload);
      fields.set("saveMode", "auto");

      setAutoSaving(true);
      try {
        const response = await saveCourse(null, fields);
        if (response.error) {
          setAutoSaveResult({ payload: draftPayload, error: response.error });
          return;
        }
        setSavedVersion(response.version);
        setSavedLesson(draftPayload);
        setAutoSaveResult({ payload: draftPayload });
      } catch {
        setAutoSaveResult({ payload: draftPayload, error: "No se pudo guardar automáticamente." });
      } finally {
        setAutoSaving(false);
      }
    }, 900);

    return () => window.clearTimeout(timer);
  }, [autoSaving, autoSaveError, busy, chapterId, courseId, draft.title, draftPayload, draggingKey, lessonChanged, lessonId, version]);

  useEffect(() => {
    const previews = localPreviews.current;
    return () => {
      for (const source of previews.values()) URL.revokeObjectURL(source);
      previews.clear();
    };
  }, []);

  useEffect(() => {
    if (!lessonChanged && !uploading && !autoSaving) return;
    function protectPendingChanges(event) {
      event.preventDefault();
      event.returnValue = true;
    }
    window.addEventListener("beforeunload", protectPendingChanges);
    return () => window.removeEventListener("beforeunload", protectPendingChanges);
  }, [lessonChanged, uploading, autoSaving]);

  function edit(change) {
    setDraft((current) => {
      const next = structuredClone(current);
      change(next);
      return next;
    });
  }

  async function uploadMedia(files, kind, blockKey) {
    if (!files.length || uploadLock.current) return;
    const mediaBlock = draft.blocks.find((block) => block.key === blockKey);
    if (!mediaBlock || mediaBlock.kind !== kind) return;
    const available = kind === "image" ? MAX_LESSON_BLOCK_IMAGES - mediaBlock.assets.length : files.length;
    const selected = files.slice(0, available);
    uploadLock.current = true;
    setUploading(true);
    setUploadError("");
    const failed = [];
    try {
      for (const file of selected) {
        try {
          const asset = await uploadAcademyMedia(course._id, file, kind);
          const source = URL.createObjectURL(file);
          localPreviews.current.set(asset.publicId, source);
          setPreviewSources((current) => ({ ...current, [asset.publicId]: source }));
          edit((next) => {
            next.blocks.find((block) => block.key === blockKey)?.assets.push(asset);
          });
        } catch {
          failed.push(file.name);
        }
      }
    } finally {
      uploadLock.current = false;
      setUploading(false);
      const messages = [];
      if (files.length > selected.length) messages.push(`El bloque admite hasta ${MAX_LESSON_BLOCK_IMAGES} imágenes.`);
      if (failed.length) messages.push(`No se pudieron cargar: ${failed.join(", ")}.`);
      setUploadError(messages.join(" "));
    }
  }

  useLayoutEffect(() => {
    const move = pendingMove.current;
    if (!move) return;
    pendingMove.current = null;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const block of blockList.current.children) {
      if (move.focusKey === block.dataset.blockKey) {
        block.querySelector("[data-reorder-handle]")?.focus({ preventScroll: true });
      }
      const offset = move.positions.get(block.dataset.blockKey) - block.offsetTop;
      if (!reducedMotion && offset) {
        block.animate(
          [{ transform: `translateY(${offset}px)` }, { transform: "translateY(0)" }],
          { duration: 190, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        );
      }
    }
  }, [draft.blocks]);

  function moveLessonBlock(key, target, focusKey) {
    const children = Array.from(blockList.current.children);
    const index = children.findIndex((block) => block.dataset.blockKey === key);
    if (index < 0 || index === target || target < 0 || target >= children.length || pendingMove.current) return;
    pendingMove.current = {
      focusKey,
      positions: new Map(children.map((block) => [block.dataset.blockKey, block.offsetTop])),
    };
    edit((next) => {
      const [moved] = next.blocks.splice(index, 1);
      next.blocks.splice(target, 0, moved);
    });
    if (focusKey) setReorderNotice(`Bloque movido a la posición ${target + 1} de ${children.length}.`);
  }

  function startBlockDrag(event, key) {
    if (event.button !== 0 || drag.current) return;
    blockList.current.setPointerCapture(event.pointerId);
    drag.current = { key, pointerId: event.pointerId, startY: event.clientY };
  }

  function dragBlock(event) {
    const active = drag.current;
    if (!active || event.pointerId !== active.pointerId) return;
    if (!draggingKey && Math.abs(event.clientY - active.startY) < 5) return;
    if (!draggingKey) setDraggingKey(active.key);
    const list = event.currentTarget;
    const pointerY = event.clientY - list.getBoundingClientRect().top;
    const siblings = Array.from(list.children).filter((block) => block.dataset.blockKey !== active.key);
    const insertion = siblings.findIndex((block) => pointerY < block.offsetTop + block.offsetHeight / 2);
    moveLessonBlock(active.key, insertion === -1 ? siblings.length : insertion);
  }

  function endBlockDrag(event) {
    if (event.pointerId !== drag.current?.pointerId) return;
    drag.current = null;
    setDraggingKey(null);
  }

  function releasePreview(assetId) {
    const source = localPreviews.current.get(assetId);
    if (!source) return;
    URL.revokeObjectURL(source);
    localPreviews.current.delete(assetId);
    setPreviewSources((current) => {
      const next = { ...current };
      delete next[assetId];
      return next;
    });
  }

  async function removeLessonBlock(event, key) {
    const block = event.currentTarget.closest("li");
    if (block && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRemovingBlock(key);
      block.getAnimations().forEach((animation) => animation.cancel());
      const animation = block.animate(
        [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(-6px)" }],
        { duration: 180, easing: "ease-in", fill: "forwards" },
      );
      await animation.finished.catch(() => {});
    }
    const removed = draft.blocks.find((item) => item.key === key);
    for (const asset of removed?.assets ?? []) {
      releasePreview(asset.publicId);
    }
    edit((next) => { next.blocks = next.blocks.filter((item) => item.key !== key); });
    setRemovingBlock(null);
  }

  function finishBlockName(key, value) {
    const label = value.trim();
    if (label) {
      edit((next) => {
        const block = next.blocks.find((item) => item.key === key);
        if (block && label !== (block.label || BLOCK_NAMES[block.kind])) block.label = label;
      });
    }
    setBlockName(null);
  }

  const renderForm = (requestClose) => (
    <form action={action} inert={previewOpen} className={`${styles.editor} ${section === "settings" || lesson ? styles.courseSettings : ""} ${lesson ? styles.lessonEntrance : ""}`}>
      <input type="hidden" name="id" value={course?._id ?? ""} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="section" value={section} />
      <input type="hidden" name="lesson" value={lesson?._id ?? ""} />
      <input type="hidden" name="chapter" value={chapter?._id ?? ""} />
      <input type="hidden" name="course" value={draftPayload} />

      {!isCreateModal && section !== "settings" && (
        <header className={styles.settingsHeading}>
          <Link href={section === "lesson" || section === "chapter" ? chapterHref : courseHref} onNavigate={(event) => {
            if (lesson && (lessonChanged || uploading || autoSaving)) event.preventDefault();
          }}>
            <ArrowLeft size={17} aria-hidden="true" />
            {section === "lesson" ? chapter.title : section === "chapter" ? "Volver al capítulo" : "Volver al curso"}
          </Link>
          {lesson ? (
            <div className={styles.lessonHeadingRow}>
              <div className={styles.lessonTitle}>
                {editingTitle ? (
                  <input
                    aria-label="Título de la lección"
                    autoFocus
                    required
                    disabled={busy}
                    value={draft.title}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                      event.preventDefault();
                      if (draft.title.trim()) setEditingTitle(false);
                    }}
                    onChange={(event) => edit((next) => { next.title = event.target.value; })}
                  />
                ) : <h1>{draft.title}</h1>}
                <button
                  type="button"
                  className={styles.lessonAction}
                  aria-label={editingTitle ? "Aceptar título" : "Cambiar título"}
                  title={editingTitle ? "Aceptar título" : "Cambiar título"}
                  disabled={busy || (editingTitle && !draft.title.trim())}
                  onClick={() => setEditingTitle(!editingTitle)}
                >
                  {editingTitle ? <Check size={18} aria-hidden="true" /> : <Pencil size={18} aria-hidden="true" />}
                </button>
              </div>
              <button
                type="button"
                ref={previewButton}
                className={styles.lessonAction}
                aria-haspopup="dialog"
                onClick={() => setPreviewOpen(true)}
              >
                <Eye size={18} aria-hidden="true" /> Vista previa
              </button>
              {autoSaveError ? (
                <button type="button" className={styles.lessonAction} onClick={() => setAutoSaveResult(null)} aria-label="Reintentar autoguardado" title="Reintentar autoguardado">
                  <CloudOff size={21} aria-hidden="true" />
                </button>
              ) : (
                <span className={styles.autoSaveIndicator} role="status" title={autoSaveStatus}>
                  {lessonChanged || autoSaving ? <CloudUpload size={21} aria-hidden="true" /> : <CloudCheck size={21} aria-hidden="true" />}
                  <span className={styles.reorderAnnouncement}>{autoSaveStatus}</span>
                </span>
              )}
            </div>
          ) : <h1>{chapter?.title ?? course.title}</h1>}
        </header>
      )}

      {section === "base" && (
        <fieldset className={course ? styles.panel : styles.modalFields} disabled={busy}>
          {course && <legend>Información básica</legend>}
          <label>Título
            <input required value={draft.title} onChange={(event) => edit((next) => { next.title = event.target.value; })} />
          </label>
          <label>Descripción
            <textarea value={draft.description} onChange={(event) => edit((next) => { next.description = event.target.value; })} />
          </label>
          <SelectInput label="Categoría" value={draft.type} disabled={busy} onChange={(event) => edit((next) => { next.type = event.target.value; })}>
            {categories.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
          </SelectInput>
        </fieldset>
      )}
      {section === "settings" && (
        <fieldset className={styles.modalFields} disabled={busy}>
          <div className={styles.settingsHeading}>
            <Link href={courseHref}><ArrowLeft size={17} aria-hidden="true" /> Volver al curso</Link>
            <h1>{course.title}</h1>
          </div>
          <div className={styles.settingsLayout}>
          <section className={styles.panel} aria-label="Publicación">
          <SelectInput label="Estado del curso" value={draft.status} disabled={busy} onChange={(event) => edit((next) => { next.status = event.target.value; })}>
            <option value="draft">Borrador</option>
            <option value="published">Publicado</option>
          </SelectInput>
          </section>
          <fieldset className={styles.panel}>
            <legend>Cargos asignados</legend>
            {roles.length ? roles.map(({ id, name, areaCode, isActive }) => (
              <label className={styles.checkbox} key={id}>
                <input
                  type="checkbox"
                  checked={draft.roleIds.includes(id)}
                  onChange={(event) => {
                    const { checked } = event.target;
                    edit((next) => {
                      next.roleIds = checked ? [...next.roleIds, id] : next.roleIds.filter((roleId) => roleId !== id);
                    });
                  }}
                />
                {name}{areaCode ? ` · ${areaCode}` : ""}{isActive === false ? " (inactivo)" : ""}
              </label>
            )) : <p>Aún no hay cargos disponibles en Empresa.</p>}
          </fieldset>
          </div>
        </fieldset>
      )}
      {section === "chapter" && (
        <fieldset className={chapter ? styles.panel : styles.modalFields} disabled={busy}>
          {chapter && <legend>Editar capítulo</legend>}
          <label>{chapter ? "Título del capítulo" : "Título"}
            <input required value={draft.title} onChange={(event) => edit((next) => { next.title = event.target.value; })} />
          </label>
        </fieldset>
      )}
      {section === "lesson" && !lesson && (
        <fieldset className={styles.modalFields} disabled={busy}>
          <label>Título
            <input required value={draft.title} onChange={(event) => edit((next) => { next.title = event.target.value; })} />
          </label>
        </fieldset>
      )}
      {lesson && (
        <>
          <div className={styles.lessonActions}>
            <button type="button" className={styles.lessonAction} disabled={busy} onClick={() => {
              const key = crypto.randomUUID();
              edit((next) => next.blocks.push({ key, kind: "text", parts: [{ style: "paragraph", text: "" }] }));
            }}>
              <FileText size={21} aria-hidden="true" /> Agregar texto
            </button>
            <button type="button" className={styles.lessonAction} disabled={busy} onClick={() => {
              const key = crypto.randomUUID();
              edit((next) => next.blocks.push({ key, kind: "video", assets: [] }));
            }}>
              <Video size={21} aria-hidden="true" /> Agregar videos
            </button>
            <button type="button" className={styles.lessonAction} disabled={busy} onClick={() => {
              const key = crypto.randomUUID();
              edit((next) => next.blocks.push({ key, kind: "image", assets: [] }));
            }}>
              <ImagePlus size={21} aria-hidden="true" /> Agregar imágenes
            </button>
            <button type="button" className={styles.lessonAction} disabled={busy} onClick={() => {
              const key = crypto.randomUUID();
              edit((next) => next.blocks.push({ key, kind: "divider" }));
            }}>
              <Minus size={21} aria-hidden="true" /> Agregar separador
            </button>
          </div>
          <span className={styles.reorderAnnouncement} role="status">{reorderNotice}</span>
          {draft.blocks.length > 0 && (
            <ol
              ref={blockList}
              className={styles.lessonBlocks}
              aria-label="Contenido de la lección"
              data-reordering={Boolean(draggingKey)}
              onPointerMove={dragBlock}
              onPointerUp={endBlockDrag}
              onPointerCancel={endBlockDrag}
              onLostPointerCapture={endBlockDrag}
            >
              {draft.blocks.map((block, index) => (
                <li
                  className={styles.panel}
                  key={block.key}
                  data-block-key={block.key}
                  data-added={!block.key.startsWith("saved-")}
                  data-dragging={draggingKey === block.key}
                >
                  <div className={styles.blockHeader}>
                    <div className={styles.blockLabel}>
                      <button
                        type="button"
                        className={`${styles.lessonAction} ${styles.blockGrip}`}
                        aria-label={`Reordenar bloque ${index + 1}`}
                        aria-keyshortcuts="ArrowUp ArrowDown"
                        title="Arrastra para mover o usa las flechas del teclado"
                        data-reorder-handle
                        disabled={busy || draft.blocks.length < 2}
                        onPointerDown={(event) => startBlockDrag(event, block.key)}
                        onKeyDown={(event) => {
                          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                          event.preventDefault();
                          moveLessonBlock(block.key, index + (event.key === "ArrowUp" ? -1 : 1), block.key);
                        }}
                      >
                        <GripVertical size={19} aria-hidden="true" />
                      </button>
                      {blockName?.key === block.key ? (
                        <input
                          className={styles.blockNameInput}
                          aria-label="Nombre interno del bloque"
                          maxLength={100}
                          autoFocus
                          value={blockName.value}
                          onChange={(event) => setBlockName({ key: block.key, value: event.target.value })}
                          onBlur={(event) => finishBlockName(block.key, event.currentTarget.value)}
                          onKeyDown={(event) => {
                            if (event.nativeEvent.isComposing) return;
                            if (event.key === "Enter") {
                              event.preventDefault();
                              event.currentTarget.blur();
                            }
                            if (event.key === "Escape") {
                              event.preventDefault();
                              setBlockName(null);
                            }
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className={styles.blockName}
                          title="Cambiar nombre interno del bloque"
                          disabled={busy}
                          onClick={() => setBlockName({ key: block.key, value: block.label || BLOCK_NAMES[block.kind] })}
                        >
                          {block.label || BLOCK_NAMES[block.kind]}
                        </button>
                      )}
                    </div>
                    <div className={styles.toolbar}>
                      <button type="button" className={`${styles.lessonAction} ${styles.removeBlock}`} aria-label="Quitar bloque" title="Quitar bloque" disabled={busy || Boolean(draggingKey)} onClick={(event) => void removeLessonBlock(event, block.key)}>
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  {block.kind === "text" ? (
                    <LessonTextBlock parts={block.parts} disabled={busy} onChange={(parts) => edit((next) => { next.blocks[index].parts = parts; })} />
                  ) : block.kind === "divider" ? (
                    <hr className={styles.lessonDivider} />
                  ) : (
                    <LessonMediaBlock
                      kind={block.kind}
                      assets={block.assets}
                      disabled={busy}
                      label={block.label}
                      previewUrls={previewUrls}
                      previewSources={previewSources}
                      onFiles={(files) => void uploadMedia(files, block.kind, block.key)}
                      onRemove={(assetId) => {
                        releasePreview(assetId);
                        edit((next) => {
                          const mediaBlock = next.blocks.find((item) => item.key === block.key);
                          mediaBlock.assets = mediaBlock.assets.filter((asset) => asset.publicId !== assetId);
                        });
                      }}
                    />
                  )}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      {autoSaveError && !autoSaving && <p className={styles.error} role="alert">{autoSaveError}</p>}
      {uploading && <p role="status">Cargando archivo en Cloudinary…</p>}
      {uploadError && <p role="alert" className={styles.error}>{uploadError}</p>}
      {result?.error && <p role="alert" className={styles.error}>{result.error}</p>}
      {!lesson && (
        <div className={styles.toolbar}>
          <button className={styles.primary} disabled={busy}>{isPending ? "Guardando…" : isCreateModal ? "Crear" : section === "chapter" ? "Guardar capítulo" : "Guardar cambios"}</button>
          {!isCreateModal ? (
            <Link href={section === "lesson" ? chapterHref : courseHref}>Cancelar</Link>
          ) : (
            <button type="button" disabled={busy} onClick={requestClose}>Cancelar</button>
          )}
        </div>
      )}
    </form>
  );

  if (!isCreateModal) {
    return (
      <>
        {renderForm()}
        {previewOpen && (
          <LessonPreview
            title={draft.title}
            blocks={draft.blocks}
            previewSources={previewSources}
            previewUrls={previewUrls}
            onClose={closePreview}
          />
        )}
      </>
    );
  }

  return (
    <FloatingModal isOpen showCloseButton={false} title={section === "lesson" ? "Crear lección" : section === "chapter" ? "Crear capítulo" : "Crear curso"} isPending={isPending} onClose={closeCreateModal}>
      {renderForm}
    </FloatingModal>
  );
}
