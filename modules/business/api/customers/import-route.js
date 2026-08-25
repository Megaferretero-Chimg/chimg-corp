import { NextResponse } from "next/server";

import connectToDatabase from "@/lib/db/mongodb";
import { getBusinessAccess } from "@/modules/business/lib/access";
import { parseCustomerWorkbook, serializeCustomerImport } from "@/modules/business/lib/customers";
import { Customer, CustomerDraft, CustomerImport } from "@/modules/business/models";

const MAX_FILE_SIZE = 15 * 1024 * 1024;

export async function POST(request) {
  const access = await getBusinessAccess("business.inventory.import");
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });
  let importDocument;
  try {
    await connectToDatabase();
    const file = (await request.formData()).get("file");
    if (!file || typeof file.arrayBuffer !== "function" || !/\.(xlsx|xls)$/i.test(file.name)) return NextResponse.json({ error: "Adjunta un archivo .xlsx o .xls válido." }, { status: 400 });
    if (!file.size || file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "El archivo está vacío o supera 15 MB." }, { status: 400 });
    const importedAt = new Date();
    importDocument = await CustomerImport.create({ fileName: file.name, fileSize: file.size, status: "processing", sourceGeneratedAt: importedAt, uploadedBy: String(access.user.employeeName || access.user.username || "SISTEMA"), uploadedByUser: String(access.user.id || "") });
    const parsed = parseCustomerWorkbook(Buffer.from(await file.arrayBuffer()));
    const byIdentification = new Map();
    parsed.customers.forEach((customer) => {
      if (byIdentification.has(customer.identification)) parsed.warnings.push(`Fila ${customer.rowNumber}: la identificación ${customer.identification} reemplazó una fila anterior.`);
      const { rowNumber: _rowNumber, ...normalized } = customer;
      byIdentification.set(customer.identification, normalized);
    });
    const customers = [...byIdentification.values()];
    await CustomerDraft.insertMany(customers.map((customer) => ({ ...customer, customerImport: importDocument._id })));
    await Customer.updateMany({}, { $set: { isActive: false } });
    await Customer.bulkWrite(customers.map((customer) => ({ updateOne: { filter: { identification: customer.identification }, update: { $set: { ...customer, isActive: true, lastImportedAt: importedAt } }, upsert: true } })), { ordered: false });
    importDocument.status = "validated";
    importDocument.totalRows = parsed.totalRows;
    importDocument.processedRows = customers.length;
    importDocument.skippedRows = parsed.totalRows - customers.length;
    importDocument.customerCount = customers.length;
    importDocument.warnings = parsed.warnings.slice(0, 100);
    importDocument.importedAt = importedAt;
    await importDocument.save();
    return NextResponse.json({ message: `Carga validada: ${customers.length} cliente(s) listos para publicar.`, customerImport: serializeCustomerImport(importDocument) }, { status: 201 });
  } catch (error) {
    if (importDocument) { importDocument.status = "failed"; importDocument.validationErrors = [String(error.message || "No se pudo procesar el archivo.")]; await importDocument.save().catch(() => {}); }
    return NextResponse.json({ error: error.message || "No se pudo importar el archivo de clientes." }, { status: 400 });
  }
}
