import * as XLSX from "xlsx";

const REQUIRED_HEADERS = [
  "CodigoVentaProducto",
  "DescripcionProducto",
  "NombreBodega",
  "ExistenciaProductoBodega",
];

function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function taxRate(row) {
  const labels = [row.NombreCuentaVenta, row.DescripcionTipoProducto, row.DescripcionTipoProducto1]
    .map(text)
    .join(" ");
  const match = labels.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (match) return number(match[1].replace(",", "."));

  const basePrice = number(row.PrecioVentaProducto);
  const priceWithTax = number(row.PrecioConIva);
  if (basePrice > 0 && priceWithTax >= basePrice) {
    return Math.max(0, Number((((priceWithTax / basePrice) - 1) * 100).toFixed(4)));
  }
  return 0;
}

export function parseInventoryWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, dense: true });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) throw new Error("El archivo no contiene hojas para importar.");

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null, raw: true });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headers.includes(header));

  if (missingHeaders.length) {
    throw new Error(`Faltan columnas obligatorias: ${missingHeaders.join(", ")}.`);
  }

  if (rows.length > 50000) throw new Error("El archivo supera el máximo de 50.000 filas por carga.");

  const warnings = [];
  const validRows = [];

  rows.forEach((row, index) => {
    const saleCode = text(row.CodigoVentaProducto || row.CodigoCatalogoProducto || row.CodigoProducto);
    const description = text(row.DescripcionProducto);
    const warehouseName = text(row.NombreBodega).toUpperCase();

    if (!saleCode || !description || !warehouseName) {
      warnings.push(`Fila ${index + 2}: faltan código, descripción o bodega.`);
      return;
    }

    validRows.push({
      rowNumber: index + 2,
      saleCode,
      warehouseName,
      product: {
        saleCode,
        catalogCode: text(row.CodigoCatalogoProducto),
        productCode: text(row.CodigoProducto),
        barcode: text(row.CodigoBarraProducto),
        description,
        companyName: text(row.NombreEmpresa),
        brand: text(row.NombreMarca),
        line: text(row.NombreLinea),
        category: text(row.NombreCategoria),
        group: text(row.NombreGrupo),
        color: text(row.NombreColor),
        productType: text(row.DescripcionTipoProducto),
        presentation: text(row.Presentacion),
        shelf: text(row.PerchaProducto),
        specialCategory: text(row.DescripcionCategoriaEspecial),
        cost: number(row.CostoProducto),
        salePrice: number(row.PrecioVentaProducto),
        priceWithTax: number(row.PrecioConIva),
        discountedPriceWithTax: number(row.PVPConDescuentoIncIVA),
        taxRate: taxRate(row),
        sourceData: row,
        isActive: true,
      },
      stock: {
        quantity: number(row.ExistenciaProductoBodega),
        fractionalQuantity: number(row.ExistenciaProductoBodegaFracciones),
        totalValue: number(row.TotalValorExistencia),
      },
    });
  });

  if (!validRows.length) throw new Error("No se encontraron filas de productos válidas.");

  return { sheetName, totalRows: rows.length, rows: validRows, warnings };
}

export function serializeImport(item) {
  return {
    id: item._id.toString(),
    fileName: item.fileName,
    fileSize: item.fileSize || 0,
    status: item.status,
    sourceGeneratedAt: item.sourceGeneratedAt || null,
    validatedAt: item.validatedAt || null,
    publishedVersion: item.publishedVersion || "",
    totalRows: item.totalRows || 0,
    processedRows: item.processedRows || 0,
    skippedRows: item.skippedRows || 0,
    productCount: item.productCount || 0,
    warehouseCount: item.warehouseCount || 0,
    stockCount: item.stockCount || 0,
    warnings: item.warnings || [],
    validationErrors: item.validationErrors || [],
    unknownWarehouses: item.unknownWarehouses || [],
    uploadedBy: item.uploadedBy || "",
    importedAt: item.importedAt || item.createdAt,
    createdAt: item.createdAt,
  };
}
