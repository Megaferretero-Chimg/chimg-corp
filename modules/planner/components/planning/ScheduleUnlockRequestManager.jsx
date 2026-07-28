"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Check, LockOpen, X } from "lucide-react";

import ConfirmDialog from "@/components/ui/ConfirmDialog";
import FloatingNotice from "@/components/ui/FloatingNotice";
import { formatEcuadorDateTimeLabel } from "@/lib/datetime/ecuador";
import styles from "@/modules/planner/styles/components/planning/ScheduleUnlockRequestManager.module.scss";

export default function ScheduleUnlockRequestManager() {
  const [requests, setRequests] = useState([]);
  const [capabilities, setCapabilities] = useState({ canReview: false });
  const [decision, setDecision] = useState(null);
  const [notice, setNotice] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  const loadRequests = useCallback(async () => {
    const response = await fetch("/api/planner/planning/schedule-unlock-requests?status=pending");
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "No se pudieron cargar las solicitudes de desbloqueo.");
    }

    setRequests(payload.requests || []);
    setCapabilities(payload.capabilities || { canReview: false });
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      try {
        await loadRequests();
      } catch (error) {
        if (!isCancelled) setNotice({ type: "error", message: error.message });
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    }

    load();

    return () => {
      isCancelled = true;
    };
  }, [loadRequests]);

  function resolveRequest() {
    if (!decision) return;

    startTransition(async () => {
      try {
        const response = await fetch(`/api/planner/planning/schedule-unlock-requests/${decision.request.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: decision.action }),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo resolver la solicitud.");
        }

        setDecision(null);
        await loadRequests();
        setNotice({ type: "success", message: payload.message || "Solicitud resuelta." });
      } catch (error) {
        setNotice({ type: "error", message: error.message });
      }
    });
  }

  return (
    <>
      <FloatingNotice notice={notice} onClose={() => setNotice(null)} />
      <ConfirmDialog
        isOpen={Boolean(decision)}
        title={decision?.action === "approve" ? "Aprobar desbloqueo" : "Rechazar desbloqueo"}
        message={decision
          ? `${decision.action === "approve" ? "La planificación se desbloqueará" : "La planificación continuará bloqueada"} para ${decision.request.groupName}, semana del ${decision.request.weekStartKey}.`
          : ""}
        confirmLabel={decision?.action === "approve" ? "Aprobar y desbloquear" : "Rechazar"}
        tone={decision?.action === "reject" ? "danger" : "warning"}
        isPending={isPending}
        onCancel={() => setDecision(null)}
        onConfirm={resolveRequest}
      />

      <section className={styles.panel}>
        <header className={styles.header}>
          <div>
            <span>Planificación semanal</span>
            <h3>Solicitudes de desbloqueo</h3>
            <p>La planificación solo se habilita cuando la solicitud es aprobada.</p>
          </div>
          <strong>{isLoading ? "…" : requests.length}</strong>
        </header>

        {isLoading ? (
          <div className={styles.loading}>Cargando solicitudes...</div>
        ) : requests.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Grupo</th>
                  <th>Semana</th>
                  <th>Solicitado por</th>
                  <th>Motivo</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id}>
                    <td>
                      <strong>{request.groupName || "Sin grupo"}</strong>
                      <span>{request.branchName || request.branchCode || ""}</span>
                    </td>
                    <td>
                      <strong>{request.weekStartKey}</strong>
                      <span>{formatEcuadorDateTimeLabel(request.requestedAt)}</span>
                    </td>
                    <td>{request.requestedBy || "Sin registro"}</td>
                    <td className={styles.reasonCell}>{request.reason}</td>
                    <td>
                      {capabilities.canReview ? (
                        <div className={styles.actions}>
                          <button
                            type="button"
                            className={styles.approveButton}
                            onClick={() => setDecision({ action: "approve", request })}
                            disabled={isPending}
                            title="Aprobar y desbloquear"
                            aria-label="Aprobar y desbloquear planificación"
                          >
                            <Check size={16} />
                          </button>
                          <button
                            type="button"
                            className={styles.rejectButton}
                            onClick={() => setDecision({ action: "reject", request })}
                            disabled={isPending}
                            title="Rechazar solicitud"
                            aria-label="Rechazar solicitud de desbloqueo"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.empty}>
            <LockOpen size={22} />
            <strong>No hay solicitudes de desbloqueo pendientes.</strong>
          </div>
        )}
      </section>
    </>
  );
}
