import * as XLSX from "xlsx";

function normalizeHeader(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function text(value) {
  return String(value ?? "").trim();
}

function valueFrom(row, aliases) {
  for (const alias of aliases) {
    const value = row.get(normalizeHeader(alias));
    if (value !== undefined && value !== null && text(value)) return text(value);
  }
  return "";
}

export function parseCustomerWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, dense: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("El archivo no contiene hojas para importar.");
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null, raw: false });
  if (rows.length > 100000) throw new Error("El archivo supera el máximo de 100.000 clientes por carga.");

  const warnings = [];
  const customers = [];
  rows.forEach((source, index) => {
    const row = new Map(Object.entries(source).map(([key, value]) => [normalizeHeader(key), value]));
    const identification = valueFrom(row, ["IdentificacionCliente", "Identificación", "Identificacion", "CedulaRuc", "Cédula/RUC", "RUC", "Cedula", "NumeroIdentificacion"]);
    const firstNames = valueFrom(row, ["NombresCliente", "Nombres", "FirstNames"]);
    const lastNames = valueFrom(row, ["ApellidosCliente", "Apellidos", "LastNames"]);
    const suppliedName = valueFrom(row, ["NombreCliente", "RazonSocialCliente", "Razón Social", "RazonSocial", "Cliente", "Nombre"]);
    const name = suppliedName || [firstNames, lastNames].filter(Boolean).join(" ");
    if (!identification || !name) {
      warnings.push(`Fila ${index + 2}: falta identificación o nombre del cliente.`);
      return;
    }
    const identificationType = valueFrom(row, ["TipoIdentificacion", "Tipo de identificación", "IdentificationType"])
      || (identification.length === 13 ? "RUC" : "CÉDULA");
    const customerType = valueFrom(row, ["TipoCliente", "Tipo de cliente", "CustomerType"])
      || (identificationType.toUpperCase().includes("RUC") ? "EMPRESA" : "PERSONA");
    customers.push({
      identification,
      identificationType: identificationType.toUpperCase(),
      customerType: customerType.toUpperCase(),
      firstNames: firstNames || (customerType.toUpperCase() === "PERSONA" ? suppliedName : ""),
      lastNames,
      name,
      address: valueFrom(row, ["DireccionCliente", "Dirección", "Direccion", "Address"]),
      phone: valueFrom(row, ["TelefonoCliente", "Teléfono", "Telefono", "Celular", "Phone"]),
      email: valueFrom(row, ["CorreoCliente", "Correo", "Email", "E-mail"]).toLowerCase(),
      city: valueFrom(row, ["CiudadCliente", "Ciudad", "City"]).toUpperCase(),
      zone: valueFrom(row, ["ZonaCliente", "Zona", "Zone"]).toUpperCase(),
      active: true,
      rowNumber: index + 2,
    });
  });
  if (!customers.length) throw new Error("No se encontraron clientes válidos. El archivo debe incluir identificación y nombre.");
  return { sheetName, totalRows: rows.length, customers, warnings };
}

export function serializeCustomerImport(item) {
  return {
    id: item._id.toString(), fileName: item.fileName, status: item.status,
    publishedVersion: item.publishedVersion || "", totalRows: item.totalRows || 0,
    processedRows: item.processedRows || 0, skippedRows: item.skippedRows || 0,
    customerCount: item.customerCount || 0, warnings: item.warnings || [],
    validationErrors: item.validationErrors || [], importedAt: item.importedAt || item.createdAt,
  };
}
