"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitCommitVertical,
  Link2,
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Signpost,
  Trash2,
  Unlink,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import CatalogDrawer from "@/components/catalog/CatalogDrawer";
import CatalogPageLoader from "@/components/catalog/CatalogPageLoader";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import FloatingModal from "@/components/ui/FloatingModal";
import FloatingNotice from "@/components/ui/FloatingNotice";
import HydrationGate from "@/components/ui/HydrationGate";
import styles from "@/modules/company/submodules/organization/styles/components/OrganizationStructureManager.module.scss";

const INITIAL_FORM = {
  code: "",
  title: "",
  subtitle: "",
  nodeType: "position",
  level: 1,
  parentId: "",
  areaCode: "",
  roleCode: "",
  responsibleEmployeeId: "",
  sortOrder: 0,
  positionX: null,
  positionY: null,
  width: null,
  height: null,
  notes: "",
  isActive: true,
};

const NODE_WIDTH = 144;
const NODE_HEIGHT = 94;
const AREA_WIDTH = 396;
const AREA_MIN_HEIGHT = 168;
const CANVAS_PADDING = 80;
const MIN_CANVAS_SCALE = 0.45;
const MAX_CANVAS_SCALE = 1.35;
const CANVAS_SCALE_STEP = 0.1;
const INITIAL_CANVAS_SCALE = 0.8;
const CANVAS_FULLSCREEN_ANIMATION_MS = 220;
const NODE_GAP_X = 180;
const NODE_GAP_Y = 122;

function mapNodeToForm(node) {
  return {
    code: node.code || "",
    title: node.title || "",
    subtitle: node.subtitle || "",
    nodeType: node.nodeType || "position",
    level: node.level || 1,
    parentId: node.parentId || "",
    areaCode: node.areaCode || "",
    roleCode: node.roleCode || "",
    responsibleEmployeeId: node.responsibleEmployeeId || "",
    sortOrder: node.sortOrder || 0,
    positionX: node.positionX,
    positionY: node.positionY,
    width: node.width,
    height: node.height,
    notes: node.notes || "",
    isActive: node.isActive !== false,
  };
}

function buildFlatNodeList(items = []) {
  const childrenByParentId = new Map();
  const roots = [];

  for (const item of items) {
    if (item.parentId) {
      const children = childrenByParentId.get(item.parentId) || [];

      children.push(item);
      childrenByParentId.set(item.parentId, children);
    } else {
      roots.push(item);
    }
  }

  function sortNodes(left, right) {
    return (left.level || 0) - (right.level || 0) ||
      (left.sortOrder || 0) - (right.sortOrder || 0) ||
      left.title.localeCompare(right.title, "es");
  }

  function visit(node, depth = 0) {
    const children = [...(childrenByParentId.get(node.id) || [])].sort(sortNodes);

    return [
      { ...node, depth },
      ...children.flatMap((child) => visit(child, depth + 1)),
    ];
  }

  return [...roots].sort(sortNodes).flatMap((node) => visit(node));
}

function getNodeDimensions(node) {
  if (node?.nodeType === "area" && node.isAreaExpanded) {
    const width = Math.max(AREA_WIDTH, Number(node.width) || AREA_WIDTH);
    const height = Math.max(AREA_MIN_HEIGHT, Number(node.height) || 0);

    return {
      width,
      height,
    };
  }

  return { width: NODE_WIDTH, height: NODE_HEIGHT };
}

function getNodeCenter(node) {
  const dimensions = getNodeDimensions(node);

  return {
    x: node.positionX + dimensions.width / 2,
    y: node.positionY + dimensions.height / 2,
  };
}

function isPointInsideNode(node, point) {
  const dimensions = getNodeDimensions(node);

  return (
    point.x >= node.positionX &&
    point.x <= node.positionX + dimensions.width &&
    point.y >= node.positionY &&
    point.y <= node.positionY + dimensions.height
  );
}

function NodeCard({
  node,
  canManage,
  isDragging,
  isResizing,
  isConnecting,
  onOpenActions,
  onPointerDown,
  onConnectorPointerDown,
  onToggleArea,
  onResizePointerDown,
}) {
  const isAreaNode = node.nodeType === "area";
  const nodeLevel = Math.min(node.level || 1, 5);
  const nodeClassName = isAreaNode ? styles.nodeArea : styles[`nodeLevel${nodeLevel}`] || "";
  const dimensions = getNodeDimensions(node);

  return (
    <article
      className={`${styles.nodeCard} ${isAreaNode ? styles.nodeAreaCard : ""} ${node.isAreaExpanded ? styles.nodeAreaExpanded : ""} ${node.isNestedInArea ? styles.nodeNestedInArea : ""} ${isDragging ? styles.nodeDragging : ""} ${isResizing ? styles.nodeResizing : ""} ${isConnecting ? styles.nodeConnecting : ""} ${!canManage ? styles.nodeReadOnly : ""} ${nodeClassName}`}
      data-node-id={node.id}
      onPointerDown={(event) => onPointerDown(event, node)}
      onDoubleClick={() => onOpenActions(node)}
      title={canManage ? "Arrastra para mover. Doble click para acciones." : "Doble click para ver acciones disponibles."}
      style={{
        left: `${node.positionX}px`,
        top: `${node.positionY}px`,
        width: `${dimensions.width}px`,
        minHeight: `${dimensions.height}px`,
      }}
    >
      {!isAreaNode ? (
        <button
          type="button"
          className={`${styles.connectorHandle} ${styles.connectorHandleTop}`}
          onPointerDown={(event) => onConnectorPointerDown(event, node, "top")}
          disabled={!canManage}
          aria-label={`Conectar hacia ${node.title}`}
          title="Arrastra para conectar"
        />
      ) : null}
      <div className={styles.nodeHeader}>
        <span className={styles.nodeLevel}>{isAreaNode ? "Área" : `Nivel ${node.level || 1}`}</span>
        {isAreaNode ? (
          <button
            type="button"
            className={styles.areaToggle}
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onToggleArea(node.id);
            }}
            aria-label={node.isAreaExpanded ? `Contraer ${node.title}` : `Expandir ${node.title}`}
            title={node.isAreaExpanded ? "Contraer área" : "Expandir área"}
          >
            {node.isAreaExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <span>{node.areaChildCount || 0}</span>
          </button>
        ) : null}
      </div>
      <strong>{node.title}</strong>
      {node.responsibleEmployeeName ? (
        <span className={styles.responsible}>{node.responsibleEmployeeName}</span>
      ) : null}
      {isAreaNode && node.isAreaExpanded && canManage ? (
        <button
          type="button"
          className={styles.areaResizeHandle}
          onPointerDown={(event) => onResizePointerDown(event, node)}
          onDoubleClick={(event) => event.stopPropagation()}
          aria-label={`Redimensionar ${node.title}`}
          title="Arrastra para cambiar el tamaño del área"
        />
      ) : null}
      {!isAreaNode ? (
        <button
          type="button"
          className={`${styles.connectorHandle} ${styles.connectorHandleBottom}`}
          onPointerDown={(event) => onConnectorPointerDown(event, node, "bottom")}
          disabled={!canManage}
          aria-label={`Conectar desde ${node.title}`}
          title="Arrastra para conectar"
        />
      ) : null}
    </article>
  );
}

function withCanvasPositions(items) {
  return items.map((node, index) => {
    const hasPosition = Number.isFinite(Number(node.positionX)) && Number.isFinite(Number(node.positionY));

    return {
      ...node,
      positionX: hasPosition ? Number(node.positionX) : 48 + (index % 5) * NODE_GAP_X,
      positionY: hasPosition ? Number(node.positionY) : 48 + Math.floor(index / 5) * NODE_GAP_Y,
      width: Number.isFinite(Number(node.width)) ? Number(node.width) : null,
      height: Number.isFinite(Number(node.height)) ? Number(node.height) : null,
    };
  });
}

export default function OrganizationStructureManager() {
  const [nodes, setNodes] = useState([]);
  const [nodeTypes, setNodeTypes] = useState([]);
  const [areas, setAreas] = useState([]);
  const [roles, setRoles] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [isEmployeeOptionsLoaded, setIsEmployeeOptionsLoaded] = useState(false);
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [form, setForm] = useState(INITIAL_FORM);
  const [search, setSearch] = useState("");
  const [editingNodeId, setEditingNodeId] = useState("");
  const [draggingNodeId, setDraggingNodeId] = useState("");
  const [canvasScale, setCanvasScale] = useState(INITIAL_CANVAS_SCALE);
  const [isCanvasPortalMounted, setIsCanvasPortalMounted] = useState(false);
  const [isCanvasClosing, setIsCanvasClosing] = useState(false);
  const [collapsedAreaIds, setCollapsedAreaIds] = useState([]);
  const [connectionDraft, setConnectionDraft] = useState(null);
  const [actionNode, setActionNode] = useState(null);
  const [nodeToDelete, setNodeToDelete] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [isSaving, startSavingTransition] = useTransition();
  const [, startLoadingTransition] = useTransition();
  const noticeExitTimeoutRef = useRef(null);
  const noticeRemoveTimeoutRef = useRef(null);
  const canvasViewportRef = useRef(null);
  const dragStateRef = useRef(null);
  const resizeStateRef = useRef(null);
  const connectionStateRef = useRef(null);
  const panStateRef = useRef(null);
  const canvasFullscreenTimeoutRef = useRef(null);
  const [isPanningCanvas, setIsPanningCanvas] = useState(false);
  const [resizingNodeId, setResizingNodeId] = useState("");

  function clearNoticeTimers() {
    if (noticeExitTimeoutRef.current) {
      window.clearTimeout(noticeExitTimeoutRef.current);
      noticeExitTimeoutRef.current = null;
    }

    if (noticeRemoveTimeoutRef.current) {
      window.clearTimeout(noticeRemoveTimeoutRef.current);
      noticeRemoveTimeoutRef.current = null;
    }
  }

  function dismissNotice() {
    clearNoticeTimers();
    setNotice((current) => (current ? { ...current, isLeaving: true } : null));
    noticeRemoveTimeoutRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeRemoveTimeoutRef.current = null;
    }, 240);
  }

  function showNotice(type, message) {
    clearNoticeTimers();
    setNotice({ type, message, isLeaving: false });
    noticeExitTimeoutRef.current = window.setTimeout(dismissNotice, 4000);
  }

  const openCanvasFullscreen = useCallback(() => {
    if (canvasFullscreenTimeoutRef.current) {
      window.clearTimeout(canvasFullscreenTimeoutRef.current);
      canvasFullscreenTimeoutRef.current = null;
    }

    setIsCanvasPortalMounted(true);
    setIsCanvasClosing(false);
  }, []);

  const closeCanvasFullscreen = useCallback(() => {
    if (canvasFullscreenTimeoutRef.current) {
      window.clearTimeout(canvasFullscreenTimeoutRef.current);
    }

    setIsCanvasClosing(true);
    canvasFullscreenTimeoutRef.current = window.setTimeout(() => {
      setIsCanvasPortalMounted(false);
      setIsCanvasClosing(false);
      canvasFullscreenTimeoutRef.current = null;
    }, CANVAS_FULLSCREEN_ANIMATION_MS);
  }, []);

  const loadStructure = useCallback(async () => {
    const response = await fetch("/api/company/organization-structure");
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "No se pudo cargar la estructura organizacional.");
    }

    setNodes(payload.nodes || []);
    setNodeTypes(payload.nodeTypes || []);
    setAreas(payload.areas || []);
    setRoles(payload.roles || []);
    if (payload.employees?.length) {
      setEmployees(payload.employees);
      setIsEmployeeOptionsLoaded(true);
    }
    setCanManage(Boolean(payload.canManage));
  }, []);

  async function ensureEmployeeOptionsLoaded() {
    if (isEmployeeOptionsLoaded || isLoadingEmployees) {
      return;
    }

    setIsLoadingEmployees(true);

    try {
      const response = await fetch("/api/company/organization-structure?resource=employees");
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "No se pudo cargar la lista de responsables.");
      }

      setEmployees(payload.employees || []);
      setIsEmployeeOptionsLoaded(true);
    } catch (error) {
      showNotice("error", error.message);
    } finally {
      setIsLoadingEmployees(false);
    }
  }

  useEffect(() => {
    return () => {
      clearNoticeTimers();
      if (canvasFullscreenTimeoutRef.current) {
        window.clearTimeout(canvasFullscreenTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    startLoadingTransition(async () => {
      try {
        await loadStructure();
      } catch (error) {
        setNotice({ type: "error", message: error.message, isLeaving: false });
      } finally {
        setIsLoading(false);
      }
    });
  }, [loadStructure]);

  useEffect(() => {
    if (!isCanvasPortalMounted) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;

    function handleEscape(event) {
      if (event.key === "Escape") {
        closeCanvasFullscreen();
      }
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [closeCanvasFullscreen, isCanvasPortalMounted]);

  const flatNodes = useMemo(() => buildFlatNodeList(nodes), [nodes]);
  const collapsedAreaIdSet = useMemo(() => new Set(collapsedAreaIds), [collapsedAreaIds]);
  const baseCanvasNodes = useMemo(() => withCanvasPositions(nodes), [nodes]);
  const areaNodesByCode = useMemo(() => {
    return new Map(
      baseCanvasNodes
        .filter((node) => node.nodeType === "area" && node.areaCode)
        .map((node) => [node.areaCode, node]),
    );
  }, [baseCanvasNodes]);
  const areaChildrenByCode = useMemo(() => {
    const childrenMap = new Map();

    for (const node of baseCanvasNodes) {
      if (node.nodeType === "area" || !node.areaCode || !areaNodesByCode.has(node.areaCode)) {
        continue;
      }

      const children = childrenMap.get(node.areaCode) || [];

      children.push(node);
      childrenMap.set(node.areaCode, children);
    }

    for (const children of childrenMap.values()) {
      children.sort((left, right) => (left.level || 0) - (right.level || 0) || (left.sortOrder || 0) - (right.sortOrder || 0) || left.title.localeCompare(right.title));
    }

    return childrenMap;
  }, [areaNodesByCode, baseCanvasNodes]);
  const canvasNodes = useMemo(() => {
    function isHiddenByCollapsedArea(node) {
      if (node.nodeType === "area" || !node.areaCode) {
        return false;
      }

      const areaNode = areaNodesByCode.get(node.areaCode);

      return areaNode ? collapsedAreaIdSet.has(areaNode.id) : false;
    }

    return baseCanvasNodes
      .filter((node) => !isHiddenByCollapsedArea(node))
      .map((node) => {
        const directAreaChildren = node.nodeType === "area"
          ? areaChildrenByCode.get(node.areaCode) || []
          : [];
        const containingArea = node.nodeType !== "area" && node.areaCode
          ? areaNodesByCode.get(node.areaCode)
          : null;
        const isInsideExpandedArea = containingArea && !collapsedAreaIdSet.has(containingArea.id);

        if (isInsideExpandedArea && draggingNodeId !== node.id) {
          return {
            ...node,
            isNestedInArea: true,
            containingAreaId: containingArea.id,
          };
        }

        return {
          ...node,
          areaChildCount: directAreaChildren.length,
          isAreaExpanded: node.nodeType === "area" && !collapsedAreaIdSet.has(node.id),
        };
      });
  }, [areaChildrenByCode, areaNodesByCode, baseCanvasNodes, collapsedAreaIdSet, draggingNodeId]);
  const canvasNodeMap = useMemo(() => new Map(canvasNodes.map((node) => [node.id, node])), [canvasNodes]);
  const canvasSize = useMemo(() => {
    const maxX = Math.max(620, ...canvasNodes.map((node) => {
      const dimensions = getNodeDimensions(node);

      return node.positionX + dimensions.width + CANVAS_PADDING;
    }));
    const maxY = Math.max(380, ...canvasNodes.map((node) => {
      const dimensions = getNodeDimensions(node);

      return node.positionY + dimensions.height + CANVAS_PADDING;
    }));

    return { width: maxX, height: maxY };
  }, [canvasNodes]);
  const connectionLines = useMemo(() => {
    return canvasNodes
      .map((node) => {
        const parent = node.parentId ? canvasNodeMap.get(node.parentId) : null;

        if (!parent || node.nodeType === "area" || parent.nodeType === "area") {
          return null;
        }
        const parentCenter = getNodeCenter(parent);
        const nodeCenter = getNodeCenter(node);

        return {
          id: `${parent.id}-${node.id}`,
          x1: parentCenter.x,
          y1: parentCenter.y,
          x2: nodeCenter.x,
          y2: nodeCenter.y,
        };
      })
      .filter(Boolean);
  }, [canvasNodeMap, canvasNodes]);

  const filteredNodes = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    if (!normalizedSearch) {
      return flatNodes;
    }

    return flatNodes.filter((node) =>
      [node.code, node.title, node.subtitle, node.areaName, node.roleName, node.responsibleEmployeeName, node.parentTitle]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch),
    );
  }, [flatNodes, search]);

  const parentOptions = useMemo(() => {
    return nodes.filter((node) => node.id !== editingNodeId);
  }, [editingNodeId, nodes]);

  const availableRoles = useMemo(() => {
    if (!form.areaCode) {
      return roles;
    }

    return roles.filter((role) => role.areaCode === form.areaCode);
  }, [form.areaCode, roles]);

  const canSubmit = Boolean(form.title.trim());

  function toggleArea(areaId) {
    setCollapsedAreaIds((current) =>
      current.includes(areaId)
        ? current.filter((id) => id !== areaId)
        : [...current, areaId],
    );
  }

  function changeCanvasScale(direction) {
    setCanvasScale((current) => {
      const nextScale = current + direction * CANVAS_SCALE_STEP;

      return Math.min(MAX_CANVAS_SCALE, Math.max(MIN_CANVAS_SCALE, Number(nextScale.toFixed(2))));
    });
  }

  function resetCanvasScale() {
    setCanvasScale(INITIAL_CANVAS_SCALE);
  }

  function updateField(name, value) {
    setForm((current) => ({
      ...current,
      [name]: value,
      ...(name === "areaCode" ? { roleCode: "" } : {}),
    }));
  }

  function openCreateDrawer(parentId = "") {
    setEditingNodeId("");
    setForm({ ...INITIAL_FORM, parentId });
    setIsDrawerOpen(true);
    ensureEmployeeOptionsLoaded();
  }

  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setEditingNodeId("");
    setForm(INITIAL_FORM);
  }, []);

  function handleEdit(node) {
    setActionNode(null);
    setEditingNodeId(node.id);
    setForm(mapNodeToForm(node));
    setIsDrawerOpen(true);
    ensureEmployeeOptionsLoaded();
  }

  async function refreshStructure() {
    setIsLoading(true);
    await loadStructure();
    setIsLoading(false);
  }

  async function saveNodePosition(nodeId, positionX, positionY, dimensions = {}) {
    try {
      const response = await fetch(`/api/company/organization-structure/${nodeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update-position",
          positionX,
          positionY,
          ...(Number.isFinite(Number(dimensions.width)) && Number.isFinite(Number(dimensions.height))
            ? {
                width: dimensions.width,
                height: dimensions.height,
              }
            : {}),
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "No se pudo guardar la posición.");
      }

      if (payload.node) {
        setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, ...payload.node } : node)));
      }
    } catch (error) {
      showNotice("error", error.message);
      await loadStructure();
    }
  }

  async function saveNodePositions(updates) {
    if (!updates.length) {
      return;
    }

    try {
      const responses = await Promise.all(updates.map((node) =>
        fetch(`/api/company/organization-structure/${node.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "update-position",
            positionX: node.positionX,
            positionY: node.positionY,
            ...(Number.isFinite(Number(node.width)) && Number.isFinite(Number(node.height))
              ? {
                  width: node.width,
                  height: node.height,
                }
              : {}),
          }),
        }),
      ));
      const failedResponse = responses.find((response) => !response.ok);

      if (failedResponse) {
        const payload = await failedResponse.json();
        throw new Error(payload.error || "No se pudieron guardar las posiciones.");
      }

      const payloads = await Promise.all(responses.map((response) => response.json()));
      const updatedNodes = payloads.map((payload) => payload.node).filter(Boolean);
      const updatedNodeMap = new Map(updatedNodes.map((node) => [node.id, node]));

      setNodes((current) => current.map((node) => updatedNodeMap.get(node.id) ? { ...node, ...updatedNodeMap.get(node.id) } : node));
      return true;
    } catch (error) {
      showNotice("error", error.message);
      await loadStructure();
      return false;
    }
  }

  async function updateNodeRelationship(childNode, parentNode, options = {}) {
    if (!childNode || parentNode?.id === childNode.id) {
      return;
    }

    const parentId = options.parentId !== undefined
      ? options.parentId
      : parentNode?.nodeType === "area" && childNode.nodeType === "position"
        ? childNode.parentId
        : parentNode?.id || "";
    const areaCode = options.areaCode !== undefined
      ? options.areaCode
      : childNode.nodeType === "area"
        ? childNode.areaCode
        : parentNode?.nodeType === "area"
          ? parentNode.areaCode
          : childNode.areaCode;

    try {
      const response = await fetch(`/api/company/organization-structure/${childNode.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update-relationship",
          parentId,
          areaCode,
          ...(Number.isFinite(Number(options.positionX)) && Number.isFinite(Number(options.positionY))
            ? {
                positionX: options.positionX,
                positionY: options.positionY,
              }
            : {}),
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "No se pudo actualizar la relación.");
      }

      await loadStructure();
      showNotice(
        "success",
        parentNode?.nodeType === "area" && childNode.nodeType === "position"
          ? `"${childNode.title}" agrupado dentro de "${parentNode.title}".`
          : parentNode
          ? `"${childNode.title}" conectado debajo de "${parentNode.title}".`
          : `"${childNode.title}" quedó fuera del área.`,
      );
    } catch (error) {
      showNotice("error", error.message);
    }
  }

  async function connectNodes(parentNode, childNode) {
    if (!parentNode || !childNode || parentNode.id === childNode.id) {
      return;
    }

    await updateNodeRelationship(childNode, parentNode);
  }

  function findExpandedAreaAtPoint(point, ignoredNodeId = "") {
    return [...canvasNodes]
      .reverse()
      .find((node) =>
        node.id !== ignoredNodeId &&
        node.nodeType === "area" &&
        node.isAreaExpanded &&
        node.areaCode &&
        isPointInsideNode(node, point),
      );
  }

  function handleNodePointerDown(event, node) {
    if (!canManage || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }

    event.preventDefault();
    const draggedAreaNodes = node.nodeType === "area" && node.areaCode
      ? nodes.filter((candidate) => candidate.id === node.id || (candidate.nodeType !== "area" && candidate.areaCode === node.areaCode))
      : [];
    dragStateRef.current = {
      pointerId: event.pointerId,
      nodeId: node.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: Number(node.positionX) || 0,
      originY: Number(node.positionY) || 0,
      latestX: Number(node.positionX) || 0,
      latestY: Number(node.positionY) || 0,
      groupNodes: draggedAreaNodes.map((candidate) => ({
        id: candidate.id,
        originX: Number(candidate.positionX) || 0,
        originY: Number(candidate.positionY) || 0,
        width: candidate.width,
        height: candidate.height,
      })),
      scale: canvasScale,
    };
    setDraggingNodeId(node.id);
    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("pointercancel", handleWindowPointerUp);
  }

  function handleWindowPointerMove(event) {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const nextX = Math.max(0, Math.round(dragState.originX + (event.clientX - dragState.startX) / dragState.scale));
    const nextY = Math.max(0, Math.round(dragState.originY + (event.clientY - dragState.startY) / dragState.scale));

    dragState.latestX = nextX;
    dragState.latestY = nextY;

    if (dragState.groupNodes?.length) {
      const deltaX = nextX - dragState.originX;
      const deltaY = nextY - dragState.originY;
      const groupedPositions = new Map(
        dragState.groupNodes.map((groupNode) => [
          groupNode.id,
          {
            positionX: Math.max(0, Math.round(groupNode.originX + deltaX)),
            positionY: Math.max(0, Math.round(groupNode.originY + deltaY)),
          },
        ]),
      );

      setNodes((current) =>
        current.map((node) =>
          groupedPositions.has(node.id)
            ? { ...node, ...groupedPositions.get(node.id) }
            : node,
        ),
      );
      return;
    }

    setNodes((current) =>
      current.map((node) =>
        node.id === dragState.nodeId
          ? { ...node, positionX: nextX, positionY: nextY }
          : node,
      ),
    );
  }

  function handleWindowPointerUp(event) {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    window.removeEventListener("pointermove", handleWindowPointerMove);
    window.removeEventListener("pointerup", handleWindowPointerUp);
    window.removeEventListener("pointercancel", handleWindowPointerUp);
    dragStateRef.current = null;
    setDraggingNodeId("");
    const draggedNode = canvasNodeMap.get(dragState.nodeId) || nodes.find((node) => node.id === dragState.nodeId);

    if (dragState.groupNodes?.length) {
      const deltaX = dragState.latestX - dragState.originX;
      const deltaY = dragState.latestY - dragState.originY;
      const updates = dragState.groupNodes.map((groupNode) => ({
        id: groupNode.id,
        positionX: Math.max(0, Math.round(groupNode.originX + deltaX)),
        positionY: Math.max(0, Math.round(groupNode.originY + deltaY)),
        width: groupNode.width,
        height: groupNode.height,
      }));

      saveNodePositions(updates);
      return;
    }

    const draggedCenter = {
      x: dragState.latestX + NODE_WIDTH / 2,
      y: dragState.latestY + NODE_HEIGHT / 2,
    };
    const targetArea = draggedNode?.nodeType === "position"
      ? findExpandedAreaAtPoint(draggedCenter, draggedNode.id)
      : null;

    if (targetArea && draggedNode.areaCode !== targetArea.areaCode) {
      updateNodeRelationship(draggedNode, targetArea, {
        parentId: draggedNode.parentId,
        positionX: dragState.latestX,
        positionY: dragState.latestY,
      });
      return;
    }

    if (draggedNode?.nodeType === "position" && draggedNode.areaCode && areaNodesByCode.has(draggedNode.areaCode) && !targetArea) {
      updateNodeRelationship(draggedNode, null, {
        parentId: draggedNode.parentId,
        areaCode: "",
        positionX: dragState.latestX,
        positionY: dragState.latestY,
      });
      return;
    }

    saveNodePosition(dragState.nodeId, dragState.latestX, dragState.latestY);
  }

  function handleResizePointerDown(event, node) {
    if (!canManage || node.nodeType !== "area" || !node.isAreaExpanded || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const dimensions = getNodeDimensions(node);

    resizeStateRef.current = {
      pointerId: event.pointerId,
      nodeId: node.id,
      startX: event.clientX,
      startY: event.clientY,
      originWidth: dimensions.width,
      originHeight: dimensions.height,
      latestWidth: dimensions.width,
      latestHeight: dimensions.height,
      minWidth: AREA_WIDTH,
      minHeight: AREA_MIN_HEIGHT,
      scale: canvasScale,
    };
    setResizingNodeId(node.id);
    window.addEventListener("pointermove", handleResizePointerMove);
    window.addEventListener("pointerup", handleResizePointerUp);
    window.addEventListener("pointercancel", handleResizePointerUp);
  }

  function handleResizePointerMove(event) {
    const resizeState = resizeStateRef.current;

    if (!resizeState || resizeState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const nextWidth = Math.max(
      resizeState.minWidth,
      Math.round(resizeState.originWidth + (event.clientX - resizeState.startX) / resizeState.scale),
    );
    const nextHeight = Math.max(
      resizeState.minHeight,
      Math.round(resizeState.originHeight + (event.clientY - resizeState.startY) / resizeState.scale),
    );

    resizeState.latestWidth = nextWidth;
    resizeState.latestHeight = nextHeight;
    setNodes((current) =>
      current.map((node) =>
        node.id === resizeState.nodeId
          ? { ...node, width: nextWidth, height: nextHeight }
          : node,
      ),
    );
  }

  function handleResizePointerUp(event) {
    const resizeState = resizeStateRef.current;

    if (!resizeState || resizeState.pointerId !== event.pointerId) {
      return;
    }

    window.removeEventListener("pointermove", handleResizePointerMove);
    window.removeEventListener("pointerup", handleResizePointerUp);
    window.removeEventListener("pointercancel", handleResizePointerUp);
    resizeStateRef.current = null;
    setResizingNodeId("");
    const resizedNode = nodes.find((node) => node.id === resizeState.nodeId);

    if (!resizedNode) {
      return;
    }

    saveNodePosition(resizeState.nodeId, resizedNode.positionX, resizedNode.positionY, {
      width: resizeState.latestWidth,
      height: resizeState.latestHeight,
    });
  }

  function getCanvasPoint(clientX, clientY) {
    const canvasElement = document.querySelector(`.${styles.canvas}`);
    const rect = canvasElement?.getBoundingClientRect();

    if (!rect) {
      return { x: 0, y: 0 };
    }

    return {
      x: Math.max(0, Math.round((clientX - rect.left) / canvasScale)),
      y: Math.max(0, Math.round((clientY - rect.top) / canvasScale)),
    };
  }

  function getNodeConnectorPoint(node, handle) {
    const dimensions = getNodeDimensions(node);

    return {
      x: node.positionX + dimensions.width / 2,
      y: node.positionY + (handle === "top" ? 0 : dimensions.height),
    };
  }

  function handleConnectorPointerDown(event, node, handle) {
    if (!canManage || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const start = getNodeConnectorPoint(node, handle);

    connectionStateRef.current = {
      pointerId: event.pointerId,
      sourceNodeId: node.id,
      sourceHandle: handle,
      start,
    };
    setConnectionDraft({
      sourceNodeId: node.id,
      x1: start.x,
      y1: start.y,
      x2: start.x,
      y2: start.y,
    });
    window.addEventListener("pointermove", handleConnectionPointerMove);
    window.addEventListener("pointerup", handleConnectionPointerUp);
    window.addEventListener("pointercancel", handleConnectionPointerUp);
  }

  function handleConnectionPointerMove(event) {
    const connectionState = connectionStateRef.current;

    if (!connectionState || connectionState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const point = getCanvasPoint(event.clientX, event.clientY);

    setConnectionDraft((current) => current ? {
      ...current,
      x2: point.x,
      y2: point.y,
    } : null);
  }

  function handleConnectionPointerUp(event) {
    const connectionState = connectionStateRef.current;

    if (!connectionState || connectionState.pointerId !== event.pointerId) {
      return;
    }

    window.removeEventListener("pointermove", handleConnectionPointerMove);
    window.removeEventListener("pointerup", handleConnectionPointerUp);
    window.removeEventListener("pointercancel", handleConnectionPointerUp);
    connectionStateRef.current = null;
    setConnectionDraft(null);

    const targetElement = document.elementFromPoint(event.clientX, event.clientY);
    const targetNodeId = targetElement?.closest?.("[data-node-id]")?.getAttribute("data-node-id");
    const sourceNode = canvasNodeMap.get(connectionState.sourceNodeId);
    const targetNode = targetNodeId ? canvasNodeMap.get(targetNodeId) : null;

    if (!sourceNode || !targetNode || sourceNode.id === targetNode.id) {
      return;
    }

    if (connectionState.sourceHandle === "bottom") {
      connectNodes(sourceNode, targetNode);
      return;
    }

    connectNodes(targetNode, sourceNode);
  }

  function handleCanvasPanPointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    if (event.target.closest?.("[data-node-id], button, input, select, textarea")) {
      return;
    }

    const viewport = canvasViewportRef.current;

    if (!viewport) {
      return;
    }

    event.preventDefault();
    panStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    setIsPanningCanvas(true);
    window.addEventListener("pointermove", handleCanvasPanPointerMove);
    window.addEventListener("pointerup", handleCanvasPanPointerUp);
    window.addEventListener("pointercancel", handleCanvasPanPointerUp);
  }

  function handleCanvasPanPointerMove(event) {
    const panState = panStateRef.current;
    const viewport = canvasViewportRef.current;

    if (!panState || !viewport || panState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    viewport.scrollLeft = panState.scrollLeft - (event.clientX - panState.startX);
    viewport.scrollTop = panState.scrollTop - (event.clientY - panState.startY);
  }

  function handleCanvasPanPointerUp(event) {
    const panState = panStateRef.current;

    if (!panState || panState.pointerId !== event.pointerId) {
      return;
    }

    window.removeEventListener("pointermove", handleCanvasPanPointerMove);
    window.removeEventListener("pointerup", handleCanvasPanPointerUp);
    window.removeEventListener("pointercancel", handleCanvasPanPointerUp);
    panStateRef.current = null;
    setIsPanningCanvas(false);
  }

  function handleSubmit(event) {
    event.preventDefault();

    startSavingTransition(async () => {
      try {
        const method = editingNodeId ? "PATCH" : "POST";
        const endpoint = editingNodeId
          ? `/api/company/organization-structure/${editingNodeId}`
          : "/api/company/organization-structure";
        const response = await fetch(endpoint, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo guardar el nodo.");
        }

        await refreshStructure();
        showNotice("success", editingNodeId ? "Nodo actualizado correctamente." : "Nodo creado correctamente.");
        closeDrawer();
      } catch (error) {
        showNotice("error", error.message);
      }
    });
  }

  function disconnectNode(node) {
    setActionNode(null);
    startSavingTransition(async () => {
      const currentParent = node.parentId
        ? canvasNodeMap.get(node.parentId) || nodes.find((candidate) => candidate.id === node.parentId)
        : null;

      await updateNodeRelationship(node, null, {
        areaCode: currentParent?.nodeType === "area" ? "" : node.areaCode,
      });
    });
  }

  function confirmDelete() {
    if (!nodeToDelete) {
      return;
    }

    startSavingTransition(async () => {
      try {
        const response = await fetch(`/api/company/organization-structure/${nodeToDelete.id}`, {
          method: "DELETE",
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo eliminar el nodo.");
        }

        await refreshStructure();
        setNodeToDelete(null);
        showNotice("success", "Nodo eliminado correctamente.");
      } catch (error) {
        showNotice("error", error.message);
      }
    });
  }

  function openDeleteConfirmation(node) {
    setActionNode(null);
    setNodeToDelete(node);
  }

  function renderCanvasPanel() {
    const isFullscreenPanel = isCanvasPortalMounted;

    return (
      <div className={`${styles.canvasPanel} ${isFullscreenPanel ? styles.canvasPanelExpanded : ""} ${isCanvasClosing ? styles.canvasPanelClosing : ""}`}>
        <div className={styles.panelHeader}>
          <div className={styles.panelTitleInline}>
            <GitBranch size={18} />
            <strong>Organigrama</strong>
          </div>
          <div className={styles.canvasControls}>
            <button type="button" onClick={() => changeCanvasScale(-1)} disabled={canvasScale <= MIN_CANVAS_SCALE} title="Reducir zoom" aria-label="Reducir zoom">
              <ZoomOut size={15} />
            </button>
            <button type="button" onClick={resetCanvasScale} title="Restablecer zoom">
              {Math.round(canvasScale * 100)}%
            </button>
            <button type="button" onClick={() => changeCanvasScale(1)} disabled={canvasScale >= MAX_CANVAS_SCALE} title="Aumentar zoom" aria-label="Aumentar zoom">
              <ZoomIn size={15} />
            </button>
            <button
              type="button"
              onClick={isFullscreenPanel ? closeCanvasFullscreen : openCanvasFullscreen}
              title={isFullscreenPanel ? "Salir de pantalla completa" : "Pantalla completa"}
              aria-label={isFullscreenPanel ? "Salir de pantalla completa" : "Pantalla completa"}
            >
              {isFullscreenPanel ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          </div>
        </div>

        {canvasNodes.length ? (
          <div
            ref={canvasViewportRef}
            className={`${styles.canvasViewport} ${isPanningCanvas ? styles.canvasViewportPanning : ""}`}
            onPointerDown={handleCanvasPanPointerDown}
          >
            <div
              className={styles.canvasScaler}
              style={{
                width: `${canvasSize.width * canvasScale}px`,
                height: `${canvasSize.height * canvasScale}px`,
              }}
            >
              <div
                className={styles.canvas}
                style={{
                  width: `${canvasSize.width}px`,
                  height: `${canvasSize.height}px`,
                  transform: `scale(${canvasScale})`,
                }}
              >
                <svg className={styles.connectionLayer} width={canvasSize.width} height={canvasSize.height} aria-hidden="true">
                  {connectionLines.map((line) => (
                    <line
                      key={line.id}
                      x1={line.x1}
                      y1={line.y1}
                      x2={line.x2}
                      y2={line.y2}
                    />
                  ))}
                  {connectionDraft ? (
                    <line
                      className={styles.connectionDraftLine}
                      x1={connectionDraft.x1}
                      y1={connectionDraft.y1}
                      x2={connectionDraft.x2}
                      y2={connectionDraft.y2}
                    />
                  ) : null}
                </svg>

                {canvasNodes.map((node) => (
                  <NodeCard
                    key={node.id}
                    node={node}
                    canManage={canManage}
                    isDragging={draggingNodeId === node.id}
                    isResizing={resizingNodeId === node.id}
                    isConnecting={connectionDraft?.sourceNodeId === node.id}
                    onOpenActions={setActionNode}
                    onPointerDown={handleNodePointerDown}
                    onConnectorPointerDown={handleConnectorPointerDown}
                    onToggleArea={toggleArea}
                    onResizePointerDown={handleResizePointerDown}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.emptyState}>
            Cuando existan áreas o cargos activos, aparecerán aquí como base del organigrama.
          </div>
        )}
      </div>
    );
  }

  return (
    <HydrationGate fallback={null}>
      {isLoading ? (
        <CatalogPageLoader formVisible={false} />
      ) : (
        <div className={styles.page}>
          <FloatingNotice notice={notice} onClose={dismissNotice} />

          <section className={styles.toolbar}>
            <div>
              <p className={styles.count}>{nodes.length} nodo{nodes.length === 1 ? "" : "s"} estructural{nodes.length === 1 ? "" : "es"}</p>
              <h2>Estructura funcional</h2>
            </div>

            <label className="catalog-search">
              <Search size={16} />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar nodo"
                className="catalog-search-input"
              />
            </label>

            <button type="button" className="catalog-button-ghost" onClick={refreshStructure} disabled={isSaving}>
              <RefreshCw size={16} />
              Actualizar
            </button>

            <button type="button" className="catalog-button-primary" onClick={() => openCreateDrawer()} disabled={!canManage}>
              <Plus size={16} />
              Agregar
            </button>
          </section>

          {!canManage ? (
            <div className={styles.readOnlyNotice}>Tu perfil puede visualizar la estructura, pero no mover nodos ni modificar conexiones.</div>
          ) : null}

          <section className={`${styles.workspace} ${isCanvasPortalMounted ? styles.workspaceExpanded : ""}`}>
            {isCanvasPortalMounted ? null : renderCanvasPanel()}

            <aside className={styles.listPanel}>
              <div className={styles.panelHeader}>
                <div className={styles.panelTitleInline}>
                  <Link2 size={18} />
                  <strong>Conexiones</strong>
                </div>
                <span className={styles.connectionCount}>{filteredNodes.length} relación{filteredNodes.length === 1 ? "" : "es"}</span>
              </div>

              <div className={styles.nodeList}>
                {filteredNodes.length ? filteredNodes.map((node) => (
                  <button
                    type="button"
                    key={node.id}
                    className={styles.listRow}
                    onClick={() => handleEdit(node)}
                    disabled={!canManage}
                  >
                    <span className={styles.connectionNode} style={{ paddingLeft: `${Math.min(node.depth, 5) * 0.75}rem` }}>
                      <GitCommitVertical size={16} />
                      <strong>{node.title}</strong>
                    </span>
                    <span className={styles.connectionMeta}>
                      <span>
                        <Signpost size={14} />
                        {node.parentTitle || "Raíz"}
                      </span>
                      <span>
                        <GitBranch size={14} />
                        {node.nodeType === "area" ? "Área" : `Nivel ${node.level || 1}`}
                      </span>
                    </span>
                  </button>
                )) : (
                  <div className={styles.emptyState}>Sin resultados.</div>
                )}
              </div>
            </aside>
          </section>

          {isCanvasPortalMounted && typeof document !== "undefined"
            ? createPortal(renderCanvasPanel(), document.body)
            : null}

          <CatalogDrawer
            isOpen={isDrawerOpen}
            eyebrow={editingNodeId ? "Modo edición" : "Nuevo nodo"}
            title={editingNodeId ? "Editar estructura" : "Agregar a estructura"}
            onClose={closeDrawer}
          >
            <form onSubmit={handleSubmit} className={`catalog-form-grid ${styles.formGrid}`}>
              <label className="catalog-field">
                <span className="catalog-label">Nombre</span>
                <input value={form.title} onChange={(event) => updateField("title", event.target.value)} className="catalog-input" required />
              </label>

              <label className="catalog-field">
                <span className="catalog-label">Código</span>
                <input value={form.code} onChange={(event) => updateField("code", event.target.value)} className="catalog-input" placeholder="Se genera desde el nombre" />
              </label>

              <label className="catalog-field">
                <span className="catalog-label">Tipo</span>
                <select value={form.nodeType} onChange={(event) => updateField("nodeType", event.target.value)} className="catalog-select">
                  {nodeTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
              </label>

              <label className="catalog-field">
                <span className="catalog-label">Conectar debajo de</span>
                <select value={form.parentId} onChange={(event) => updateField("parentId", event.target.value)} className="catalog-select">
                  <option value="">Sin padre / raíz</option>
                  {parentOptions.map((node) => (
                    <option key={node.id} value={node.id}>{node.title}</option>
                  ))}
                </select>
              </label>

              <label className="catalog-field">
                <span className="catalog-label">Área relacionada</span>
                <select value={form.areaCode} onChange={(event) => updateField("areaCode", event.target.value)} className="catalog-select">
                  <option value="">Sin área</option>
                  {areas.map((area) => <option key={area.code} value={area.code}>{area.name}</option>)}
                </select>
              </label>

              <label className="catalog-field">
                <span className="catalog-label">Cargo relacionado</span>
                <select value={form.roleCode} onChange={(event) => updateField("roleCode", event.target.value)} className="catalog-select">
                  <option value="">Sin cargo</option>
                  {availableRoles.map((role) => <option key={role.code} value={role.code}>{role.name}</option>)}
                </select>
              </label>

              <label className="catalog-field">
                <span className="catalog-label">Responsable</span>
                <select
                  value={form.responsibleEmployeeId}
                  onChange={(event) => updateField("responsibleEmployeeId", event.target.value)}
                  className="catalog-select"
                  disabled={isLoadingEmployees}
                >
                  <option value="">Sin responsable</option>
                  {isLoadingEmployees ? <option value="" disabled>Cargando responsables...</option> : null}
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.fullName}{employee.dni ? ` · ${employee.dni}` : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label className="catalog-field">
                <span className="catalog-label">Subtítulo</span>
                <input value={form.subtitle} onChange={(event) => updateField("subtitle", event.target.value)} className="catalog-input" placeholder="Ej. Área comercial" />
              </label>

              <label className="catalog-field">
                <span className="catalog-label">Orden</span>
                <input type="number" value={form.sortOrder} onChange={(event) => updateField("sortOrder", Number(event.target.value))} className="catalog-input" />
              </label>

              <label className={`catalog-field ${styles.notesField}`}>
                <span className="catalog-label">Notas</span>
                <textarea value={form.notes} onChange={(event) => updateField("notes", event.target.value)} className="catalog-input" rows={3} />
              </label>

              <label className="catalog-field">
                <span className="catalog-label">Estado</span>
                <button
                  type="button"
                  className={`catalog-switch ${form.isActive ? "is-active" : ""}`}
                  onClick={() => updateField("isActive", !form.isActive)}
                  aria-pressed={form.isActive}
                >
                  <span className="catalog-switchKnob" />
                  <span>{form.isActive ? "Activo" : "Inactivo"}</span>
                </button>
              </label>

              <div className={`catalog-actions catalog-actions-end ${styles.actions}`}>
                <button type="button" className="catalog-button-ghost" onClick={closeDrawer} disabled={isSaving}>
                  Cancelar
                </button>
                <button type="submit" className="catalog-button-primary" disabled={!canSubmit || isSaving}>
                  {isSaving ? "Guardando..." : editingNodeId ? "Actualizar" : "Crear"}
                </button>
              </div>
            </form>
          </CatalogDrawer>

          <FloatingModal
            isOpen={Boolean(actionNode)}
            eyebrow="Nodo del organigrama"
            title={actionNode?.title || "Acciones"}
            onClose={() => setActionNode(null)}
            isPending={isSaving}
          >
            {actionNode ? (
              <div className={styles.actionModal}>
                <div className={styles.actionMeta}>
                  <span>{actionNode.nodeType === "area" ? "Área" : `Nivel ${actionNode.level || 1}`}</span>
                  {actionNode.parentTitle ? <span>Depende de {actionNode.parentTitle}</span> : <span>Sin padre</span>}
                </div>

                <div className={styles.actionButtons}>
                  <button type="button" onClick={() => handleEdit(actionNode)} disabled={!canManage || isSaving}>
                    <Pencil size={16} />
                    Editar
                  </button>
                  <button type="button" onClick={() => disconnectNode(actionNode)} disabled={!canManage || isSaving || !actionNode.parentId}>
                    <Unlink size={16} />
                    Desconectar
                  </button>
                  <button type="button" className={styles.dangerAction} onClick={() => openDeleteConfirmation(actionNode)} disabled={!canManage || isSaving}>
                    <Trash2 size={16} />
                    Eliminar
                  </button>
                </div>
              </div>
            ) : null}
          </FloatingModal>

          <ConfirmDialog
            isOpen={Boolean(nodeToDelete)}
            title="Eliminar nodo"
            message={`¿Deseas eliminar "${nodeToDelete?.title || ""}"? Sus nodos hijos quedarán desconectados.`}
            confirmLabel={isSaving ? "Eliminando..." : "Eliminar"}
            isPending={isSaving}
            onCancel={() => setNodeToDelete(null)}
            onConfirm={confirmDelete}
          />
        </div>
      )}
    </HydrationGate>
  );
}
