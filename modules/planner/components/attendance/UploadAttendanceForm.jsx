"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileSpreadsheet,
  History,
  Upload,
  X,
} from "lucide-react";
import FloatingNotice from "@/components/ui/FloatingNotice";
import SelectInput from "@/components/ui/SelectInput";
import { planningModulePath } from "@/modules/planner/routes";
import { formatEcuadorMonthKey } from "@/lib/datetime/ecuador";
import styles from "@/modules/planner/styles/components/attendance/UploadAttendanceForm.module.scss";

const ACCEPTED_EXTENSIONS = [".xls", ".xlsx", ".csv", ".dat"];
const ACCEPTED_FILES_LABEL = ACCEPTED_EXTENSIONS.join(", ");
const STATUS_LABELS = {
  uploaded: "Cargado",
  processing: "Procesando",
  processed: "Procesado",
  failed: "Fallido",
};

function hasValidExcelExtension(fileName) {
  const normalizedName = String(fileName || "").toLowerCase();
  return ACCEPTED_EXTENSIONS.some((extension) => normalizedName.endsWith(extension));
}

function formatFileSize(bytes) {
  if (!bytes) {
    return "0 KB";
  }

  const sizeInKb = bytes / 1024;

  if (sizeInKb < 1024) {
    return `${sizeInKb.toFixed(1)} KB`;
  }

  return `${(sizeInKb / 1024).toFixed(2)} MB`;
}

function formatDateTime(value) {
  if (!value) {
    return "N/D";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "N/D";
  }

  return format(parsed, "dd/MM/yyyy HH:mm", { locale: es });
}

function formatUploadStatus(status) {
  return STATUS_LABELS[status] || status || "N/D";
}

function formatPeriod(month, year) {
  if (!month || !year) {
    return "N/D";
  }

  const date = new Date(Number(year), Number(month) - 1, 1);

  if (Number.isNaN(date.getTime())) {
    return "N/D";
  }

  return format(date, "MMMM yyyy", { locale: es });
}

function formatMonthKeyLabel(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})$/);

  if (!match) {
    return "Mes no definido";
  }

  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  const label = format(date, "MMMM 'de' yyyy", { locale: es });

  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

function moveMonth(value, amount) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})$/);

  if (!match) {
    return formatEcuadorMonthKey();
  }

  const date = new Date(Number(match[1]), Number(match[2]) - 1 + amount, 1);

  return format(date, "yyyy-MM");
}

function formatAuditActor(upload) {
  return upload?.uploadedBy || upload?.uploadedByUser || "Sistema";
}

async function readJsonResponse(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      error: response.ok
        ? "La respuesta del servidor no tuvo el formato esperado."
        : "El servidor devolvió una respuesta no legible.",
    };
  }
}

export default function UploadAttendanceForm() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [branchCode, setBranchCode] = useState("");
  const [monthKey, setMonthKey] = useState(() => formatEcuadorMonthKey());
  const [branches, setBranches] = useState([]);
  const [savedUpload, setSavedUpload] = useState(null);
  const [uploadsHistory, setUploadsHistory] = useState([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef(null);
  const noticeExitTimeoutRef = useRef(null);
  const noticeRemoveTimeoutRef = useRef(null);
  const isUploadLocked = Boolean(savedUpload);
  const isInitialLoading = isHistoryLoading && !branches.length && !uploadsHistory.length && !savedUpload;
  const branchOptions = branches.map((branch) => ({
    value: branch.code,
    label: branch.name || branch.code,
  }));
  const canSubmit = Boolean(selectedFile && branchCode && monthKey && !isPending && !isUploadLocked);

  const clearNoticeTimers = useCallback(() => {
    if (noticeExitTimeoutRef.current) {
      window.clearTimeout(noticeExitTimeoutRef.current);
      noticeExitTimeoutRef.current = null;
    }

    if (noticeRemoveTimeoutRef.current) {
      window.clearTimeout(noticeRemoveTimeoutRef.current);
      noticeRemoveTimeoutRef.current = null;
    }
  }, []);

  const dismissNotice = useCallback(() => {
    clearNoticeTimers();
    setNotice((current) => (current ? { ...current, isLeaving: true } : null));
    noticeRemoveTimeoutRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeRemoveTimeoutRef.current = null;
    }, 240);
  }, [clearNoticeTimers]);

  const showNotice = useCallback((type, message) => {
    clearNoticeTimers();
    setNotice({ type, message, isLeaving: false });
    noticeExitTimeoutRef.current = window.setTimeout(() => {
      dismissNotice();
    }, 5000);
  }, [clearNoticeTimers, dismissNotice]);

  const resetFileInput = useCallback(() => {
    setSelectedFile(null);

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }, []);

  const applySelectedFile = useCallback((file) => {
    if (isUploadLocked) {
      return;
    }

    if (!file) {
      return;
    }

    if (!hasValidExcelExtension(file.name)) {
      showNotice("error", "Solo se permiten archivos .xls, .xlsx, .csv o .dat.");
      return;
    }

    setNotice(null);
    setSavedUpload(null);
    setSelectedFile(file);
  }, [isUploadLocked, showNotice]);

  function handleInputChange(event) {
    applySelectedFile(event.target.files?.[0] || null);
  }

  function handleDrop(event) {
    event.preventDefault();
    setIsDragging(false);

    if (isUploadLocked) {
      return;
    }

    applySelectedFile(event.dataTransfer.files?.[0] || null);
  }

  function handleSubmit(event) {
    event.preventDefault();

    if (!selectedFile) {
      showNotice("error", "Selecciona un archivo biométrico para continuar.");
      return;
    }

    if (!branchCode) {
      showNotice("error", "Selecciona la sucursal de origen del archivo.");
      return;
    }

    if (!monthKey) {
      showNotice("error", "Selecciona el mes al que pertenece la carga.");
      return;
    }

    setNotice(null);

    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append("file", selectedFile);
        formData.append("branchCode", branchCode);
        formData.append("monthKey", monthKey);

        const request = await fetch("/api/planner/attendance/upload", {
          method: "POST",
          body: formData,
        });

        const payload = await readJsonResponse(request);

        if (!request.ok) {
          throw new Error(payload.error || "No se pudo guardar el archivo.");
        }

        setSavedUpload(payload.upload || null);
        setUploadsHistory((current) => [payload.upload, ...current.filter((item) => item.id !== payload.upload?.id)].slice(0, 20));
        showNotice("success", payload.message || "Archivo guardado correctamente.");
        resetFileInput();
      } catch (submissionError) {
        setSavedUpload(null);
        showNotice("error", submissionError.message);
      }
    });
  }

  function handleNewUpload() {
    setSavedUpload(null);
    setBranchCode("");
    resetFileInput();
  }

  useEffect(() => {
    let isCancelled = false;

    async function fetchUploadsHistory() {
      try {
        if (!isCancelled) {
          setIsHistoryLoading(true);
        }

        const [response, branchesResponse] = await Promise.all([
          fetch("/api/planner/attendance/upload"),
          fetch("/api/company/branches"),
        ]);
        const payload = await readJsonResponse(response);
        const branchesPayload = await readJsonResponse(branchesResponse);

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo cargar el historial.");
        }

        if (!branchesResponse.ok) {
          throw new Error(branchesPayload.error || "No se pudieron cargar las sucursales.");
        }

        if (!isCancelled) {
          setUploadsHistory(payload.uploads || []);
          setBranches(branchesPayload.branches || []);
        }
      } catch (historyError) {
        if (!isCancelled) {
          showNotice("error", historyError.message);
        }
      } finally {
        if (!isCancelled) {
          setIsHistoryLoading(false);
        }
      }
    }

    fetchUploadsHistory();

    return () => {
      isCancelled = true;
      clearNoticeTimers();
    };
  }, [clearNoticeTimers, showNotice]);

  return (
    <>
      <FloatingNotice notice={notice} onClose={dismissNotice} />

      <section className={styles.panel}>
        {isInitialLoading ? (
          <div className={styles.loadingSkeleton} aria-busy="true" aria-label="Cargando">
            <div className={styles.skeletonHeader}>
              <span className={`${styles.skeletonLine} ${styles.skeletonEyebrow}`} />
              <span className={`${styles.skeletonLine} ${styles.skeletonTitle}`} />
              <span className={`${styles.skeletonLine} ${styles.skeletonText}`} />
            </div>
            <span className={`${styles.skeletonLine} ${styles.skeletonSelect}`} />
            <div className={styles.skeletonDropzone}>
              <span className={styles.skeletonIcon} />
              <span className={`${styles.skeletonLine} ${styles.skeletonDropTitle}`} />
              <span className={`${styles.skeletonLine} ${styles.skeletonDropText}`} />
            </div>
            <span className={`${styles.skeletonLine} ${styles.skeletonButton}`} />
            <div className={styles.skeletonHistory}>
              <div className={styles.skeletonHistoryHeader}>
                <span className={`${styles.skeletonLine} ${styles.skeletonHistoryTitle}`} />
                <span className={styles.skeletonBadge} />
              </div>
              {[0, 1, 2].map((item) => (
                <div key={item} className={styles.skeletonHistoryItem}>
                  <div>
                    <span className={`${styles.skeletonLine} ${styles.skeletonItemTitle}`} />
                    <span className={`${styles.skeletonLine} ${styles.skeletonItemText}`} />
                  </div>
                  <span className={styles.skeletonItemAction} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className={styles.contentGrid}>
              <div className={styles.uploadColumn}>
                <form onSubmit={handleSubmit} className={styles.form}>
                  <div className={styles.header}>
                    <h2 className={styles.title}>Nueva carga</h2>
                  </div>

                  <div className={styles.fieldGrid}>
                    <SelectInput
                      label="Sucursal"
                      className={styles.field}
                      labelClassName={styles.label}
                      controlClassName={styles.selectControl}
                      selectClassName={styles.selectButton}
                      value={branchCode}
                      onChange={(event) => setBranchCode(event.target.value)}
                      disabled={isUploadLocked || isPending}
                    >
                      <option value="">Seleccionar</option>
                      {branchOptions.map((branch) => (
                        <option key={branch.value} value={branch.value}>
                          {branch.label}
                        </option>
                      ))}
                    </SelectInput>

                    <div className={`${styles.field} ${styles.monthField}`}>
                      <span className={styles.label}>Mes</span>
                      <div className={styles.monthSlider}>
                        <button
                          type="button"
                          aria-label="Mes anterior"
                          title="Mes anterior"
                          onClick={() => setMonthKey((current) => moveMonth(current, -1))}
                          disabled={isUploadLocked || isPending}
                        >
                          <ChevronLeft size={17} aria-hidden="true" />
                        </button>
                        <output aria-live="polite">{formatMonthKeyLabel(monthKey)}</output>
                        <button
                          type="button"
                          aria-label="Mes siguiente"
                          title="Mes siguiente"
                          onClick={() => setMonthKey((current) => moveMonth(current, 1))}
                          disabled={isUploadLocked || isPending}
                        >
                          <ChevronRight size={17} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div
                    className={`${styles.dropzone} ${isDragging ? styles.dropzoneActive : ""} ${
                      isUploadLocked || isPending ? styles.dropzoneLocked : ""
                    }`}
                    onDragOver={(event) => {
                      if (isUploadLocked || isPending) {
                        return;
                      }

                      event.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => {
                      if (!isUploadLocked && !isPending) {
                        inputRef.current?.click();
                      }
                    }}
                    role="button"
                    tabIndex={isUploadLocked || isPending ? -1 : 0}
                    aria-disabled={isUploadLocked || isPending}
                    onKeyDown={(event) => {
                      if (isUploadLocked || isPending) {
                        return;
                      }

                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        inputRef.current?.click();
                      }
                    }}
                  >
                    <div className={styles.dropzoneIcon}>
                      <FileSpreadsheet size={26} />
                    </div>
                    <span className={styles.fieldTitle}>
                      {isUploadLocked
                        ? "Archivo guardado"
                        : selectedFile
                          ? selectedFile.name
                          : "Arrastra el archivo aquí"}
                    </span>
                    <span className={styles.fieldHint}>
                      {isUploadLocked
                        ? "Abre la revisión para validar y cargar las picadas."
                        : selectedFile
                          ? `${formatFileSize(selectedFile.size)} · ${selectedFile.type || "Tipo no disponible"}`
                          : `Clic para buscar. Permitidos: ${ACCEPTED_FILES_LABEL}`}
                    </span>

                    <input
                      ref={inputRef}
                      type="file"
                      accept={ACCEPTED_FILES_LABEL}
                      onChange={handleInputChange}
                      className={styles.fileInput}
                      disabled={isUploadLocked || isPending}
                    />
                  </div>

                  {selectedFile && !isUploadLocked ? (
                    <div className={styles.selectedFileCard}>
                      <div className={styles.selectedFileIcon}>
                        <FileSpreadsheet size={18} />
                      </div>
                      <div className={styles.selectedFileContent}>
                        <p className={styles.selectedFileName}>{selectedFile.name}</p>
                        <p className={styles.selectedFileMeta}>
                          {formatFileSize(selectedFile.size)} · {selectedFile.type || "Tipo no disponible"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setNotice(null);
                          resetFileInput();
                        }}
                        className={styles.removeFileButton}
                        aria-label="Quitar archivo"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : null}

                  <div className={styles.actions}>
                    <button
                      type="submit"
                      disabled={!canSubmit}
                      className={styles.submit}
                    >
                      <Upload size={16} />
                      {isPending ? "Guardando..." : "Guardar archivo"}
                    </button>
                  </div>
                </form>

                {savedUpload ? (
                  <div className={styles.stack}>
                    <div className={styles.summaryGrid}>
                      {[
                        { label: "Archivo", value: savedUpload.fileName || "N/D" },
                        { label: "Sucursal", value: savedUpload.branchName || savedUpload.branchCode || "N/D" },
                        { label: "Periodo", value: formatPeriod(savedUpload.month, savedUpload.year) },
                        { label: "Estado", value: formatUploadStatus(savedUpload.status) },
                        { label: "Tamaño", value: formatFileSize(savedUpload.fileSize || 0) },
                        { label: "Subido por", value: formatAuditActor(savedUpload) },
                        { label: "Hora de subida", value: formatDateTime(savedUpload.uploadedAt || savedUpload.createdAt) },
                      ].map((item) => (
                        <div key={item.label} className={styles.summaryCard}>
                          <p className={styles.summaryLabel}>{item.label}</p>
                          <p className={styles.summaryValueSmall}>{item.value}</p>
                        </div>
                      ))}
                    </div>
                    <div className={styles.secondaryActions}>
                      <Link href={planningModulePath(`/attendance/uploads/${savedUpload.id}`)} className={styles.reviewButton}>
                        Abrir revisión
                      </Link>
                      <button type="button" className={styles.newUploadButton} onClick={handleNewUpload}>
                        Cargar otro archivo
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <aside className={styles.historySection}>
                <div className={styles.historyHeader}>
                  <div>
                    <h3 className={styles.historyTitle}>Historial reciente</h3>
                  </div>
                  <div className={styles.historyBadge}>
                    <History size={16} />
                    <span>{uploadsHistory.length}</span>
                  </div>
                </div>

                {isHistoryLoading ? (
                  <div className={styles.historyEmpty}>
                    <Clock3 size={16} />
                    <span>Cargando historial de archivos...</span>
                  </div>
                ) : uploadsHistory.length ? (
                  <div className={styles.historyList}>
                    {uploadsHistory.map((upload) => (
                      <article key={upload.id} className={styles.historyItem}>
                        <div className={styles.historyItemMain}>
                          <p className={styles.historyFileName}>{upload.fileName}</p>
                          <p className={styles.historyMeta}>
                            {[
                              upload.branchName || upload.branchCode,
                              formatPeriod(upload.month, upload.year),
                              formatFileSize(upload.fileSize || 0),
                              formatAuditActor(upload),
                              formatDateTime(upload.uploadedAt || upload.createdAt),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        <div className={styles.historyItemSide}>
                          <div className={styles.historyStatuses}>
                            <span className={styles.historyStatus}>
                              {formatUploadStatus(upload.status)}
                            </span>
                            {upload.punchesPublishedAt ? (
                              <span className={styles.historyPublishedStatus}>
                                <CheckCircle2 size={14} />
                                Publicadas · {formatDateTime(upload.punchesPublishedAt)}
                              </span>
                            ) : (
                              <span className={styles.historyPendingStatus}>Sin publicar</span>
                            )}
                          </div>
                          <Link href={planningModulePath(`/attendance/uploads/${upload.id}`)} className={styles.historyAction}>
                            Revisar
                          </Link>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className={styles.historyEmpty}>
                    <FileSpreadsheet size={16} />
                    <span>Todavía no hay archivos cargados en el historial.</span>
                  </div>
                )}
              </aside>
            </div>
          </>
        )}
      </section>
    </>
  );
}
