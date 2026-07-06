export const ORGANIZATION_NODE_TYPES = [
  { value: "position", label: "Cargo" },
  { value: "area", label: "Área" },
  { value: "committee", label: "Comité" },
  { value: "support", label: "Soporte" },
  { value: "external", label: "Externo" },
];

export const ORGANIZATION_LEVELS = [
  { value: 1, label: "Nivel 1 · Gerencia" },
  { value: 2, label: "Nivel 2 · Delegación / apoyo" },
  { value: 3, label: "Nivel 3 · Jefatura" },
  { value: 4, label: "Nivel 4 · Responsable" },
  { value: 5, label: "Nivel 5 · Operativo" },
];

export const MAX_ORGANIZATION_LEVEL = ORGANIZATION_LEVELS.at(-1)?.value || 5;

function normalizeText(value) {
  return String(value || "").trim();
}

export function inferOrganizationNodeLevel(parent) {
  if (!parent) {
    return 1;
  }

  const parentLevel = Number(parent.level || 1);
  const normalizedParentLevel = Number.isFinite(parentLevel)
    ? Math.max(Math.round(parentLevel), 1)
    : 1;

  return Math.min(normalizedParentLevel + 1, MAX_ORGANIZATION_LEVEL);
}

export function normalizeOrganizationNodeCode(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s_-]/g, " ")
    .trim()
    .replace(/[\s_-]+/g, "_")
    .toUpperCase();
}

export function normalizeOrganizationNodePayload(body, { parent, area, role, employee } = {}) {
  const title = normalizeText(body?.title);
  const code = normalizeOrganizationNodeCode(body?.code || title);
  const nodeType = normalizeText(body?.nodeType || "position").toLowerCase();
  const level = Number(body?.level || 1);
  const positionX = Number(body?.positionX);
  const positionY = Number(body?.positionY);
  const width = Number(body?.width);
  const height = Number(body?.height);

  if (!title) {
    throw new Error("El nombre del nodo es obligatorio.");
  }

  if (!code) {
    throw new Error("No se pudo generar el código del nodo.");
  }

  const allowedTypes = new Set(ORGANIZATION_NODE_TYPES.map((type) => type.value));

  return {
    code,
    title,
    subtitle: normalizeText(body?.subtitle),
    nodeType: allowedTypes.has(nodeType) ? nodeType : "position",
    level: Number.isFinite(level) ? Math.min(Math.max(Math.round(level), 1), 10) : 1,
    parentId: parent?._id?.toString() || "",
    parentTitle: parent?.title || "",
    areaCode: area?.code || "",
    areaName: area?.name || "",
    roleCode: role?.code || "",
    roleName: role?.name || "",
    responsibleEmployeeId: employee?._id?.toString() || "",
    responsibleEmployeeName: employee?.fullName || "",
    sortOrder: Number.isFinite(Number(body?.sortOrder)) ? Number(body.sortOrder) : 0,
    positionX: Number.isFinite(positionX) ? positionX : null,
    positionY: Number.isFinite(positionY) ? positionY : null,
    width: Number.isFinite(width) ? width : null,
    height: Number.isFinite(height) ? height : null,
    notes: normalizeText(body?.notes),
    isActive: body?.isActive === undefined ? true : Boolean(body.isActive),
  };
}

export function serializeOrganizationNode(node) {
  return {
    id: node._id.toString(),
    code: node.code || "",
    title: node.title || "",
    subtitle: node.subtitle || "",
    nodeType: node.nodeType || "position",
    level: node.level || 1,
    parentId: node.parentId || "",
    parentTitle: node.parentTitle || "",
    areaCode: node.areaCode || "",
    areaName: node.areaName || "",
    roleCode: node.roleCode || "",
    roleName: node.roleName || "",
    responsibleEmployeeId: node.responsibleEmployeeId || "",
    responsibleEmployeeName: node.responsibleEmployeeName || "",
    sortOrder: node.sortOrder || 0,
    positionX: Number.isFinite(Number(node.positionX)) ? Number(node.positionX) : null,
    positionY: Number.isFinite(Number(node.positionY)) ? Number(node.positionY) : null,
    width: Number.isFinite(Number(node.width)) ? Number(node.width) : null,
    height: Number.isFinite(Number(node.height)) ? Number(node.height) : null,
    notes: node.notes || "",
    isActive: node.isActive !== false,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
}

export function buildOrganizationTree(nodes) {
  const nodeMap = new Map(nodes.map((node) => [node.id, { ...node, children: [] }]));
  const roots = [];

  for (const node of nodeMap.values()) {
    if (node.parentId && nodeMap.has(node.parentId)) {
      nodeMap.get(node.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  }

  function sortTree(items) {
    items.sort((left, right) => left.sortOrder - right.sortOrder || left.title.localeCompare(right.title));
    items.forEach((item) => sortTree(item.children));
    return items;
  }

  return sortTree(roots);
}

function buildAreaNodeCode(area) {
  return normalizeOrganizationNodeCode(`AREA_${area.code || area.name}`);
}

function buildRoleNodeCode(role) {
  return normalizeOrganizationNodeCode(`CARGO_${role.code || role.name}`);
}

function buildPatch(currentNode, nextValues) {
  return Object.entries(nextValues).reduce((patch, [key, value]) => {
    const currentValue = currentNode?.[key] === undefined ? "" : currentNode[key];

    if (currentValue !== value) {
      patch[key] = value;
    }

    return patch;
  }, {});
}

export function buildCatalogStructureSyncPlan({ areas = [], roles = [], existingNodes = [] } = {}) {
  const allNodesByCode = new Map(existingNodes.map((node) => [normalizeOrganizationNodeCode(node.code), node]));
  const activeNodes = existingNodes.filter((node) => node.isActive !== false);
  const nodesByCode = new Map(activeNodes.map((node) => [normalizeOrganizationNodeCode(node.code), node]));
  const areaNodesByCode = new Map(
    activeNodes
      .filter((node) => node.nodeType === "area" && node.areaCode)
      .map((node) => [node.areaCode, node]),
  );
  const roleNodesByCode = new Map(
    activeNodes
      .filter((node) => node.nodeType === "position" && node.roleCode)
      .map((node) => [node.roleCode, node]),
  );
  const creates = [];
  const updates = [];

  for (const [index, area] of areas.entries()) {
    const areaCode = normalizeText(area.code);
    const areaName = normalizeText(area.name);
    const nodeCode = buildAreaNodeCode({ code: areaCode, name: areaName });
    const positionX = 48 + (index % 5) * 180;
    const positionY = 48 + Math.floor(index / 5) * 122;

    if (!areaName) {
      continue;
    }

    if (allNodesByCode.get(nodeCode)?.isActive === false) {
      continue;
    }

    const existingNode = areaNodesByCode.get(areaCode) || nodesByCode.get(nodeCode);
    const values = {
      title: areaName,
      nodeType: "area",
      areaCode,
      areaName,
      roleCode: "",
      roleName: "",
      isActive: area.isActive !== false,
    };

    if (existingNode) {
      if (!Number.isFinite(Number(existingNode.positionX))) {
        values.positionX = positionX;
      }

      if (!Number.isFinite(Number(existingNode.positionY))) {
        values.positionY = positionY;
      }

      const patch = buildPatch(existingNode, values);

      if (Object.keys(patch).length) {
        updates.push({ id: existingNode._id.toString(), patch });
      }

      continue;
    }

    creates.push({
      code: nodeCode,
      title: areaName,
      subtitle: "Área funcional",
      nodeType: "area",
      level: 1,
      parentId: "",
      parentTitle: "",
      areaCode,
      areaName,
      roleCode: "",
      roleName: "",
      responsibleEmployeeId: "",
      responsibleEmployeeName: "",
      sortOrder: index + 1,
      positionX,
      positionY,
      notes: "Generado desde el catálogo de áreas.",
      isActive: area.isActive !== false,
    });
  }

  for (const [index, role] of roles.entries()) {
    const roleCode = normalizeText(role.code);
    const roleName = normalizeText(role.name);
    const areaName = normalizeText(role.areaName);
    const areaCode = normalizeText(role.areaCode);
    const supervisorRoleCode = normalizeText(role.supervisorRoleCode);
    const supervisorNode = supervisorRoleCode ? roleNodesByCode.get(supervisorRoleCode) : null;
    const controlsSupervisor = Object.hasOwn(role, "supervisorRoleCode");
    const nodeCode = buildRoleNodeCode({ code: roleCode, name: roleName });
    const positionIndex = areas.length + index;
    const positionX = 48 + (positionIndex % 5) * 180;
    const positionY = 48 + Math.floor(positionIndex / 5) * 122;

    if (!roleName) {
      continue;
    }

    if (allNodesByCode.get(nodeCode)?.isActive === false) {
      continue;
    }

    const existingNode = roleNodesByCode.get(roleCode) || nodesByCode.get(nodeCode);
    const values = {
      title: roleName,
      nodeType: "position",
      areaCode,
      areaName,
      roleCode,
      roleName,
      isActive: role.isActive !== false,
    };

    if (controlsSupervisor) {
      values.parentId = supervisorNode?._id?.toString() || "";
      values.parentTitle = supervisorNode?.title || "";
      values.level = inferOrganizationNodeLevel(supervisorNode);
    }

    if (existingNode) {
      if (!Number.isFinite(Number(existingNode.positionX))) {
        values.positionX = positionX;
      }

      if (!Number.isFinite(Number(existingNode.positionY))) {
        values.positionY = positionY;
      }

      const patch = buildPatch(existingNode, values);

      if (Object.keys(patch).length) {
        updates.push({ id: existingNode._id.toString(), patch });
      }

      continue;
    }

    creates.push({
      code: nodeCode,
      title: roleName,
      subtitle: areaName || "Cargo funcional",
      nodeType: "position",
      level: inferOrganizationNodeLevel(supervisorNode),
      parentId: supervisorNode?._id?.toString() || "",
      parentTitle: supervisorNode?.title || "",
      areaCode,
      areaName,
      roleCode,
      roleName,
      responsibleEmployeeId: "",
      responsibleEmployeeName: "",
      sortOrder: areas.length + index + 1,
      positionX,
      positionY,
      notes: "Generado desde el catálogo de cargos.",
      isActive: role.isActive !== false,
    });
  }

  return { creates, updates };
}
