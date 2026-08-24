import { NextResponse } from "next/server";

import connectToDatabase from "@/lib/db/mongodb";
import { getBusinessAccess } from "@/modules/business/lib/access";
import { PendingCustomer, SyncGuide } from "@/modules/business/models";

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function GET(request) {
  const access = await getBusinessAccess("business.syncDocuments.view");
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

  try {
    await connectToDatabase();
    const { searchParams } = new URL(request.url);
    const status = String(searchParams.get("status") || "").trim();
    const search = String(searchParams.get("search") || "").trim();
    const warehouse = String(searchParams.get("warehouse") || "").trim();
    const guideQuery = {};
    const customerQuery = {};
    if (status) { guideQuery.status = status; customerQuery.status = status; }
    if (warehouse) guideQuery.warehouse = warehouse;
    if (search) {
      const regex = { $regex: escapeRegex(search), $options: "i" };
      guideQuery.$or = ["internalNumber", "cashierName", "customerName", "deviceId"].map((field) => ({ [field]: regex }));
      customerQuery.$or = ["identification", "name", "city", "deviceId"].map((field) => ({ [field]: regex }));
    }

    const [guides, customers] = await Promise.all([
      SyncGuide.find(guideQuery).sort({ receivedAt: -1 }).limit(100).lean(),
      PendingCustomer.find(customerQuery).sort({ receivedAt: -1 }).limit(100).lean(),
    ]);
    return NextResponse.json({
      guides: guides.map((item) => ({
        id: item._id.toString(), syncUuid: item.syncUuid, deviceId: item.deviceId,
        internalNumber: item.internalNumber, warehouse: item.warehouse, cashierName: item.cashierName,
        sellerName: item.sellerName, customerIdentification: item.customerIdentification,
        customerName: item.customerName, total: item.total, localCreatedAt: item.localCreatedAt,
        receivedAt: item.receivedAt, status: item.status, snapshot: item.snapshot,
      })),
      pendingCustomers: customers.map((item) => ({
        id: item._id.toString(), syncUuid: item.syncUuid, deviceId: item.deviceId,
        identification: item.identification, name: item.name, city: item.city,
        localCreatedAt: item.localCreatedAt, receivedAt: item.receivedAt,
        status: item.status, snapshot: item.snapshot,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "No se pudieron cargar los documentos." }, { status: 500 });
  }
}
