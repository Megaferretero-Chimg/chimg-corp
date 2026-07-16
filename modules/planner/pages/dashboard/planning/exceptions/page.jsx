import ModuleShell from "@/components/shell/ModuleShell";
import ExceptionManager from "@/modules/planner/components/planning/ExceptionManager";

export const metadata = {
  title: "Todos los ajustes y excepciones | Control de Asistencia",
};

function firstSearchValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeInitialDraft(searchParams = {}) {
  const employeeId = String(firstSearchValue(searchParams.employeeId) || "").trim();
  const dateKey = String(firstSearchValue(searchParams.dateKey) || "").trim();
  const flowType = String(firstSearchValue(searchParams.flowType) || "").trim();
  const scope = String(firstSearchValue(searchParams.scope) || "").trim();
  const notes = String(firstSearchValue(searchParams.notes) || "").trim();
  const month = String(firstSearchValue(searchParams.month) || "").trim();

  if (!employeeId && !dateKey && !flowType && !scope && !notes && !month) {
    return null;
  }

  return {
    employeeId,
    dateKey,
    flowType,
    scope,
    notes,
    month,
  };
}

export default async function PlanningExceptionsPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;

  return (
    <ModuleShell
      title="Todos los ajustes y excepciones"
      description=""
    >
      <ExceptionManager
        eyebrow=""
        title=""
        description=""
        listTitle="Todos los registros"
        initialDraft={normalizeInitialDraft(resolvedSearchParams)}
        compactListView
      />
    </ModuleShell>
  );
}
