import { useEffect, useRef, useState } from "react";

import FloatingModal from "@/components/ui/FloatingModal";
import LessonMediaPreview from "@/modules/academy/components/LessonMediaPreview";
import { gradeAttempt, selectAttemptQuestions } from "@/modules/academy/lib/evaluation-attempt";
import styles from "@/modules/academy/styles/evaluation-preview.module.scss";
import adminStyles from "@/modules/academy/styles/admin.module.scss";

const formatGrade = new Intl.NumberFormat("es-EC", { maximumFractionDigits: 2 });

function formatTime(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function timeExpired(deadline) {
  return deadline != null && Date.now() >= deadline;
}

function Attempt({ bank, settings, previewSources, previewUrls }) {
  const [attempt, setAttempt] = useState(null);
  const [answers, setAnswers] = useState({});
  const [remaining, setRemaining] = useState(null);
  const [finishReason, setFinishReason] = useState(null);
  const startButton = useRef(null);
  const resultHeading = useRef(null);
  const count = Math.min(settings.questionsPerAttempt ?? bank.length, bank.length);
  const deadline = attempt?.deadline;

  useEffect(() => {
    startButton.current?.focus();
  }, []);

  useEffect(() => {
    if (finishReason) resultHeading.current?.focus();
  }, [finishReason]);

  useEffect(() => {
    if (deadline == null || finishReason) return;
    const interval = window.setInterval(() => {
      const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(seconds);
      if (seconds === 0) setFinishReason("timeout");
    }, 200);
    return () => window.clearInterval(interval);
  }, [deadline, finishReason]);

  function start() {
    const seconds = settings.timeLimitMinutes === null ? null : settings.timeLimitMinutes * 60;
    setAttempt({
      questions: selectAttemptQuestions(bank, settings.questionsPerAttempt),
      deadline: seconds === null ? null : Date.now() + seconds * 1000,
    });
    setAnswers({});
    setRemaining(seconds);
    setFinishReason(null);
  }

  function handleAnswer(id, option) {
    if (timeExpired(deadline)) {
      setFinishReason("timeout");
      return;
    }
    setAnswers((current) => {
      if (!settings.allowAnswerChanges && current[id] !== undefined) return current;
      return { ...current, [id]: option };
    });
  }

  if (!attempt) {
    return (
      <div className={styles.preview}>
        <p>{count} {count === 1 ? "pregunta" : "preguntas"} · {settings.timeLimitMinutes === null ? "Sin límite de tiempo" : `${settings.timeLimitMinutes} min`} · Sobre {formatGrade.format(settings.maxGrade)}</p>
        {!settings.allowAnswerChanges && <p>Las respuestas quedan fijas al seleccionarlas.</p>}
        <button ref={startButton} type="button" className={adminStyles.primary} onClick={start}>Iniciar intento</button>
      </div>
    );
  }

  if (finishReason) {
    const { grade, correct } = gradeAttempt(attempt.questions, answers, settings.maxGrade);
    return (
      <section className={styles.preview}>
        <h2 ref={resultHeading} tabIndex={-1}>{finishReason === "timeout" ? "Tiempo agotado" : "Evaluación entregada"}</h2>
        <p className={styles.grade}>Nota final <strong>{formatGrade.format(grade)} / {formatGrade.format(settings.maxGrade)}</strong></p>
        <p>{correct} de {attempt.questions.length} correctas · {attempt.questions.length - Object.keys(answers).length} sin responder</p>
        <button type="button" className={adminStyles.primary} onClick={start}>Nuevo intento</button>
      </section>
    );
  }

  return (
    <div className={styles.preview}>
      <div className={styles.progress}>
        <span>{Object.keys(answers).length} de {attempt.questions.length} respondidas</span>
        {remaining !== null && <span role="timer" aria-label="Tiempo restante">{formatTime(remaining)}</span>}
      </div>
      {attempt.questions.map((question, index) => {
        const selected = answers[question._id];
        return (
          <fieldset className={styles.question} key={question._id} disabled={!settings.allowAnswerChanges && selected !== undefined}>
            <legend>{index + 1}. {question.prompt}</legend>
            {question.images.length > 0 && (
              <div className={styles.images}>
                {question.images.map((image, imageIndex) => (
                  <LessonMediaPreview key={image.publicId} asset={image} src={previewSources[image.publicId] ?? previewUrls[image.publicId]} label={`Imagen ${imageIndex + 1} de la pregunta ${index + 1}`} />
                ))}
              </div>
            )}
            {question.options.map((option, optionIndex) => (
              <label className={styles.option} key={optionIndex}>
                <input type="radio" name={`preview-${question._id}`} checked={selected === optionIndex} onChange={() => handleAnswer(question._id, optionIndex)} />
                {option}
              </label>
            ))}
          </fieldset>
        );
      })}
      <button type="button" className={adminStyles.primary} onClick={() => setFinishReason(timeExpired(deadline) ? "timeout" : "submitted")}>Entregar evaluación</button>
    </div>
  );
}

export default function EvaluationPreview({ onClose, ...props }) {
  return (
    <FloatingModal isOpen isFullscreen title="Vista previa de la evaluación" onClose={onClose}>
      <Attempt {...props} />
    </FloatingModal>
  );
}
