import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import connectToDatabase from "@/lib/db/mongodb";
import { AttendanceUpload } from "@/modules/planner/models";
import { Branch } from "@/modules/company/models";

const ACCEPTED_EXTENSIONS = [".xls", ".xlsx", ".csv", ".dat"];

function parseMonthKey(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }

  return { month, year };
}

function hasValidExcelExtension(fileName) {
  const normalizedName = String(fileName || "").toLowerCase();
  return ACCEPTED_EXTENSIONS.some((extension) => normalizedName.endsWith(extension));
}

export async function GET() {
  try {
    const authenticatedUser = await getAuthenticatedUser();

    if (!authenticatedUser) {
      return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
    }

    await connectToDatabase();

    const uploads = await AttendanceUpload.find(
      {},
      {
        originalFile: 0,
      },
    )
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    return NextResponse.json({
      uploads: uploads.map((upload) => ({
        id: upload._id.toString(),
        fileName: upload.fileName,
        mimeType: upload.mimeType,
        fileSize: upload.fileSize,
        branchCode: upload.branchCode || "",
        branchName: upload.branchName || "",
        status: upload.status,
        month: upload.month,
        year: upload.year,
        normalizedAt: upload.normalizedAt || null,
        hasNormalization: Boolean(upload.normalizedAt),
        punchesPublishedAt: upload.punchesPublishedAt || null,
        uploadedBy: upload.uploadedBy || "",
        uploadedByUser: upload.uploadedByUser || "",
        uploadedAt: upload.uploadedAt || upload.createdAt,
        createdAt: upload.createdAt,
        updatedAt: upload.updatedAt,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "No se pudo cargar el historial de archivos." },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  try {
    const authenticatedUser = await getAuthenticatedUser();

    if (!authenticatedUser) {
      return NextResponse.json({ error: "Sesión inválida o expirada." }, { status: 401 });
    }

    await connectToDatabase();

    const formData = await request.formData();
    const file = formData.get("file");
    const branchCode = String(formData.get("branchCode") || "").trim().toUpperCase();
    const period = parseMonthKey(formData.get("monthKey"));

    if (!file || typeof file.arrayBuffer !== "function") {
      return NextResponse.json(
        { error: "Debes adjuntar un archivo biométrico válido." },
        { status: 400 },
      );
    }

    if (!hasValidExcelExtension(file.name)) {
      return NextResponse.json(
        { error: "Solo se permiten archivos .xls, .xlsx, .csv o .dat." },
        { status: 400 },
      );
    }

    if (!branchCode) {
      return NextResponse.json(
        { error: "Selecciona la sucursal de origen del biométrico." },
        { status: 400 },
      );
    }

    if (!period) {
      return NextResponse.json(
        { error: "Selecciona el mes al que pertenece la carga." },
        { status: 400 },
      );
    }

    const branch = await Branch.findOne({ code: branchCode }).lean();

    if (!branch) {
      return NextResponse.json(
        { error: "La sucursal seleccionada no existe." },
        { status: 400 },
      );
    }

    const originalFile = Buffer.from(await file.arrayBuffer());
    const uploadedAt = new Date();
    const uploadedBy = String(
      authenticatedUser.employeeName ||
        authenticatedUser.username ||
        authenticatedUser.id ||
        "SISTEMA",
    ).trim();
    const uploadedByUser = String(authenticatedUser.id || authenticatedUser.username || "").trim();

    if (!originalFile.length) {
      return NextResponse.json(
        { error: "El archivo está vacío o no se pudo leer." },
        { status: 400 },
      );
    }

    const uploadDocument = await AttendanceUpload.create({
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      fileSize: originalFile.length,
      originalFile,
      branchCode,
      branchName: branch.name || branchCode,
      month: period.month,
      year: period.year,
      status: "uploaded",
      uploadedBy,
      uploadedByUser,
      uploadedAt,
    });

    return NextResponse.json({
      message: "Archivo guardado correctamente.",
      upload: {
        id: uploadDocument._id.toString(),
        fileName: uploadDocument.fileName,
        mimeType: uploadDocument.mimeType,
        fileSize: uploadDocument.fileSize,
        branchCode: uploadDocument.branchCode,
        branchName: uploadDocument.branchName,
        month: uploadDocument.month,
        year: uploadDocument.year,
        status: uploadDocument.status,
        normalizedAt: null,
        hasNormalization: false,
        punchesPublishedAt: null,
        uploadedBy: uploadDocument.uploadedBy || "",
        uploadedByUser: uploadDocument.uploadedByUser || "",
        uploadedAt: uploadDocument.uploadedAt || uploadDocument.createdAt,
        createdAt: uploadDocument.createdAt,
      },
    });
  } catch (error) {
    console.error("attendance-upload-store-error", error);

    return NextResponse.json(
      { error: error.message || "No se pudo guardar el archivo de asistencia." },
      { status: 500 },
    );
  }
}
