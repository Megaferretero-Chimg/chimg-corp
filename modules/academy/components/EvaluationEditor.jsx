"use client";

import { ArrowLeft, CloudCheck, CloudOff, CloudUpload, Eye, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { saveCourse } from "@/modules/academy/actions/save-course";
import EvaluationPreview from "@/modules/academy/components/EvaluationPreview";
import LessonMediaBlock from "@/modules/academy/components/LessonMediaBlock";
import { uploadAcademyMedia } from "@/modules/academy/lib/upload-media";
import { ACADEMY_COURSES_PATH, MAX_QUESTION_IMAGES, isValidQuestionPoints } from "@/modules/academy/module";
import styles from "@/modules/academy/styles/admin.module.scss";

const numberOrNull = (value) => value === "" ? null : Number(value);

export default function EvaluationEditor({ courseId, version, chapterId, chapterTitle, questions, evaluation, previewUrls }) {
  const chapterHref = `${ACADEMY_COURSES_PATH}?edit=${courseId}&section=chapter&chapter=${chapterId}`;
  const [bank, setBank] = useState(() => questions.map(({ image, ...question }) => ({
    ...question, images: question.images ?? (image ? [image] : []), points: question.points ?? 1,
  })));
  const [settings, setSettings] = useState(() => ({
    timeLimitMinutes: evaluation?.timeLimitMinutes ?? null,
    questionsPerAttempt: evaluation?.questionsPerAttempt ?? null,
    allowAnswerChanges: evaluation?.allowAnswerChanges ?? true,
    maxGrade: evaluation?.maxGrade ?? 10,
  }));
  const previews = useRef(new Map());
  const uploadLock = useRef(false);
  const [previewSources, setPreviewSources] = useState({});
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewButton = useRef(null);
  const closePreview = useCallback(() => {
    setPreviewOpen(false);
    window.requestAnimationFrame(() => previewButton.current?.focus());
  }, []);
  const [saving, setSaving] = useState(false);
  const [savedVersion, setSavedVersion] = useState(version);
  const [failed, setFailed] = useState(null);
  const payload = JSON.stringify({ questions: bank, evaluation: settings });
  const [savedPayload, setSavedPayload] = useState(payload);
  const dirty = payload !== savedPayload;
  const [removingQuestion, setRemovingQuestion] = useState(false);
  const busy = uploading || removingQuestion;
  const saveError = failed?.payload === payload ? failed.error : null;
  const completeQuestions = bank.filter(({ prompt, options, points }) =>
    prompt.trim() && options.every((option) => option.trim()) && isValidQuestionPoints(points),
  ).length;
  const complete = completeQuestions === bank.length && settings.maxGrade >= 0.01 &&
    [settings.timeLimitMinutes, settings.questionsPerAttempt].every((value) => value === null || (Number.isInteger(value) && value >= 1));
  const effectiveCount = Math.min(settings.questionsPerAttempt ?? completeQuestions, completeQuestions);
  const status = saving ? "Guardando cambios" : dirty ? "Cambios pendientes" : "Cambios guardados";

  useEffect(() => {
    if (!dirty || !complete || busy || saving || saveError) return;
    const timer = window.setTimeout(async () => {
      const fields = new FormData();
      fields.set("id", courseId);
      fields.set("version", String(savedVersion));
      fields.set("section", "evaluation");
      fields.set("chapter", chapterId);
      fields.set("course", payload);
      fields.set("saveMode", "auto");
      setSaving(true);
      try {
        const result = await saveCourse(null, fields);
        if (result.error) {
          setFailed({ payload, error: result.error });
        } else {
          setSavedVersion(result.version);
          setSavedPayload(payload);
        }
      } catch {
        setFailed({ payload, error: "No se pudo guardar automáticamente." });
      } finally {
        setSaving(false);
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [busy, chapterId, complete, courseId, dirty, payload, saveError, savedVersion, saving]);

  useEffect(() => {
    if (!dirty && !uploading && !saving) return;
    function protectPendingChanges(event) {
      event.preventDefault();
      event.returnValue = true;
    }
    window.addEventListener("beforeunload", protectPendingChanges);
    return () => window.removeEventListener("beforeunload", protectPendingChanges);
  }, [dirty, uploading, saving]);

  useEffect(() => {
    const sources = previews.current;
    return () => {
      for (const source of sources.values()) URL.revokeObjectURL(source);
      sources.clear();
    };
  }, []);

  function updateQuestion(index, changes) {
    setBank((current) => current.map((question, position) => position === index ? { ...question, ...changes } : question));
  }

  function releasePreview(image) {
    const source = previews.current.get(image?.publicId);
    if (!source) return;
    URL.revokeObjectURL(source);
    previews.current.delete(image.publicId);
    setPreviewSources((current) => {
      const next = { ...current };
      delete next[image.publicId];
      return next;
    });
  }

  async function removeQuestion(event, question) {
    const card = event.currentTarget.closest("fieldset");
    if (card && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRemovingQuestion(true);
      card.getAnimations().forEach((animation) => animation.cancel());
      const animation = card.animate(
        [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(-6px)" }],
        { duration: 180, easing: "ease-in", fill: "forwards" },
      );
      await animation.finished.catch(() => {});
    }
    question.images.forEach(releasePreview);
    setBank((current) => current.filter(({ _id }) => _id !== question._id));
    setRemovingQuestion(false);
  }

  async function uploadImages(files, index) {
    if (!files.length || uploadLock.current) return;
    const images = [...bank[index].images];
    const selected = files.slice(0, MAX_QUESTION_IMAGES - images.length);
    uploadLock.current = true;
    setUploading(true);
    setUploadError("");
    const failedFiles = [];
    try {
      for (const file of selected) {
        try {
          const image = await uploadAcademyMedia(courseId, file, "image");
          const source = URL.createObjectURL(file);
          previews.current.set(image.publicId, source);
          setPreviewSources((current) => ({ ...current, [image.publicId]: source }));
          images.push(image);
        } catch {
          failedFiles.push(file.name);
        }
      }
      updateQuestion(index, { images: [...images] });
    } finally {
      uploadLock.current = false;
      setUploading(false);
      const messages = [];
      if (files.length > selected.length) messages.push(`Cada pregunta admite hasta ${MAX_QUESTION_IMAGES} imágenes.`);
      if (failedFiles.length) messages.push(`No se pudieron cargar: ${failedFiles.join(", ")}.`);
      setUploadError(messages.join(" "));
    }
  }

  return (
    <>
      <div inert={previewOpen} className={`${styles.editor} ${styles.courseSettings} ${styles.lessonEntrance}`}>
        <header className={styles.settingsHeading}>
          <Link href={chapterHref} onNavigate={(event) => {
            if (uploading || saving || (dirty && complete && !saveError)) {
              event.preventDefault();
            } else if (dirty && !window.confirm("Hay cambios sin guardar. ¿Volver al capítulo?")) {
              event.preventDefault();
            }
          }}><ArrowLeft size={17} aria-hidden="true" /> {chapterTitle}</Link>
          <div className={styles.evaluationBankHeader}>
            <h1>Evaluación</h1>
            <div className={styles.toolbar}>
              <button
                type="button"
                ref={previewButton}
                className={styles.lessonAction}
                aria-haspopup="dialog"
                disabled={busy || !complete || effectiveCount < 1}
                title={complete && effectiveCount > 0 ? undefined : "Completa la configuración y al menos una pregunta"}
                onClick={() => setPreviewOpen(true)}
              ><Eye size={18} aria-hidden="true" /> Vista previa</button>
              {saveError ? (
                <button type="button" className={styles.lessonAction} aria-label="Reintentar autoguardado" title="Reintentar autoguardado" onClick={() => setFailed(null)}>
                  <CloudOff size={21} aria-hidden="true" />
                </button>
              ) : (
                <span className={styles.autoSaveIndicator} title={status} role="status">
                  {dirty || saving ? <CloudUpload size={21} aria-hidden="true" /> : <CloudCheck size={21} aria-hidden="true" />}
                  <span className={styles.reorderAnnouncement}>{status}</span>
                </span>
              )}
            </div>
          </div>
          {saveError && <p role="alert" className={styles.error}>{saveError}</p>}
        </header>

        <fieldset className={styles.attemptSettings} disabled={busy} aria-labelledby="attempt-settings-title">
          <h2 id="attempt-settings-title">Configuración del intento</h2>
          <div className={styles.attemptControls}>
            <label>
              <span>Tiempo límite</span>
              <div className={styles.attemptValue}>
                <input type="number" aria-label="Tiempo límite en minutos" min={1} step={1} placeholder="Sin límite" value={settings.timeLimitMinutes ?? ""} onChange={(event) => setSettings({ ...settings, timeLimitMinutes: numberOrNull(event.target.value) })} />
                <span aria-hidden="true">min</span>
              </div>
            </label>
            <label>
              <span>Máximo de preguntas</span>
              <input type="number" min={1} step={1} placeholder="Todas" aria-describedby="attempt-question-count" value={settings.questionsPerAttempt ?? ""} onChange={(event) => setSettings({ ...settings, questionsPerAttempt: numberOrNull(event.target.value) })} />
              <small id="attempt-question-count">{Math.max(0, effectiveCount)} disponibles por intento</small>
            </label>
            <label>
              <span>Nota máxima</span>
              <div className={styles.attemptValue}>
                <input type="number" aria-label="Nota máxima" required min={0.01} step={0.01} value={settings.maxGrade ?? ""} onChange={(event) => setSettings({ ...settings, maxGrade: numberOrNull(event.target.value) })} />
                <span aria-hidden="true">pts</span>
              </div>
            </label>
            <label className={styles.answerChanges}>
              <span>Cambiar respuestas</span>
              <input type="checkbox" role="switch" checked={settings.allowAnswerChanges} aria-describedby="answer-changes-hint" onChange={(event) => setSettings({ ...settings, allowAnswerChanges: event.target.checked })} />
              <small id="answer-changes-hint">Antes de entregar el intento</small>
            </label>
          </div>
        </fieldset>

        <section className={styles.evaluationBank} aria-labelledby="evaluation-bank-title">
          <div className={styles.evaluationBankHeader}>
            <h2 id="evaluation-bank-title">Banco de preguntas <span>({bank.length})</span></h2>
            <button type="button" className={styles.lessonAction} disabled={busy} onClick={() => {
              const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, "0")).join("");
              setBank((current) => [...current, { _id: id, prompt: "", options: ["", ""], correctOptionIndex: 0, points: 1, images: [] }]);
            }}><Plus size={18} aria-hidden="true" /> Añadir pregunta</button>
          </div>
          <p>Los puntos de cada pregunta indican su peso. La nota se calcula sobre la escala que elijas.</p>
          {bank.map((question, index) => {
            return (
              <fieldset className={`${styles.panel} ${styles.questionCard}`} key={question._id} disabled={busy} data-added={!questions.some(({ _id }) => _id === question._id)} aria-label={`Pregunta ${index + 1}`}>
                <div className={styles.evaluationBankHeader}>
                  <strong>Pregunta {index + 1}</strong>
                  <button type="button" className={`${styles.lessonAction} ${styles.removeBlock}`} aria-label={`Quitar pregunta ${index + 1}`} title="Quitar pregunta" onClick={(event) => void removeQuestion(event, question)}><Trash2 size={18} aria-hidden="true" /></button>
                </div>
                <div className={styles.questionFields}>
                  <label>Enunciado
                    <textarea required rows={2} value={question.prompt} onChange={(event) => updateQuestion(index, { prompt: event.target.value })} />
                  </label>
                  <label>Puntos
                    <input required type="number" min={0.01} step={0.01} value={question.points ?? ""} onChange={(event) => {
                      const points = numberOrNull(event.target.value);
                      if (points === null || Number(points.toFixed(2)) === points) updateQuestion(index, { points });
                    }} />
                  </label>
                </div>
                <LessonMediaBlock
                  kind="image"
                  assets={question.images}
                  maxImages={MAX_QUESTION_IMAGES}
                  label={`Pregunta ${index + 1}`}
                  disabled={busy}
                  previewUrls={previewUrls}
                  previewSources={previewSources}
                  onFiles={(files) => void uploadImages(files, index)}
                  onRemove={(assetId) => {
                    releasePreview(question.images.find((image) => image.publicId === assetId));
                    updateQuestion(index, { images: question.images.filter((image) => image.publicId !== assetId) });
                  }}
                />
                <fieldset className={styles.group}>
                  <legend>Opciones y respuesta correcta</legend>
                  {question.options.map((option, optionIndex) => (
                    <div className={styles.questionOption} key={optionIndex}>
                      <input type="radio" name={`correct-${index}`} aria-label={`Marcar opción ${optionIndex + 1} como correcta`} checked={question.correctOptionIndex === optionIndex} onChange={() => updateQuestion(index, { correctOptionIndex: optionIndex })} />
                      <input required aria-label={`Opción ${optionIndex + 1}`} placeholder={`Opción ${optionIndex + 1}`} value={option} onChange={(event) => {
                        const value = event.target.value;
                        updateQuestion(index, { options: question.options.map((item, position) => position === optionIndex ? value : item) });
                      }} />
                      <button type="button" className={`${styles.lessonAction} ${styles.removeBlock}`} aria-label={`Quitar opción ${optionIndex + 1}`} disabled={question.options.length <= 2} onClick={() => {
                        const correct = question.correctOptionIndex;
                        updateQuestion(index, {
                          options: question.options.filter((_, position) => position !== optionIndex),
                          correctOptionIndex: correct === optionIndex ? 0 : correct - Number(correct > optionIndex),
                        });
                      }}><Trash2 size={16} aria-hidden="true" /></button>
                    </div>
                  ))}
                  <button type="button" onClick={() => updateQuestion(index, { options: [...question.options, ""] })}>Añadir opción</button>
                </fieldset>
              </fieldset>
            );
          })}
        </section>

        {uploading && <p role="status">Cargando imagen…</p>}
        {uploadError && <p role="alert" className={styles.error}>{uploadError}</p>}
      </div>
      {previewOpen && (
        <EvaluationPreview
          bank={bank}
          settings={settings}
          previewSources={previewSources}
          previewUrls={previewUrls}
          onClose={closePreview}
        />
      )}
    </>
  );
}
