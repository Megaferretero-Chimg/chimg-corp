import { NextResponse } from "next/server";

import connectToDatabase from "@/lib/db/mongodb";
import { getBusinessAccess } from "@/modules/business/lib/access";
import { serializeCustomerImport } from "@/modules/business/lib/customers";
import { serializeCustomerPublication } from "@/modules/business/lib/customer-publication";
import { Customer, CustomerImport, CustomerPublication } from "@/modules/business/models";

function escapeRegex(value) { return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export async function GET(request) {
  const access = await getBusinessAccess("business.inventory.view");
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });
  try {
    await connectToDatabase();
    const { searchParams } = new URL(request.url);
    const search = String(searchParams.get("search") || "").trim();
    const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1);
    const pageSize = 30;
    const query = search ? { $or: ["identification", "name", "city", "phone", "email"].map((field) => ({ [field]: { $regex: escapeRegex(search), $options: "i" } })) } : {};
    const [customers, total, allCount, personCount, companyCount, cities, imports, publications] = await Promise.all([
      Customer.find(query).sort({ name: 1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
      Customer.countDocuments(query), Customer.countDocuments({ isActive: { $ne: false } }),
      Customer.countDocuments({ isActive: { $ne: false }, customerType: { $regex: "PERSONA", $options: "i" } }),
      Customer.countDocuments({ isActive: { $ne: false }, customerType: { $regex: "EMPRESA", $options: "i" } }),
      Customer.distinct("city", { isActive: { $ne: false }, city: { $ne: "" } }),
      CustomerImport.find({}).sort({ createdAt: -1 }).limit(8).lean(),
      CustomerPublication.find({}).sort({ publishedAt: -1 }).limit(8).lean(),
    ]);
    return NextResponse.json({
      customers: customers.map((item) => ({ id: item._id.toString(), identification: item.identification, identificationType: item.identificationType, customerType: item.customerType, firstNames: item.firstNames, lastNames: item.lastNames, name: item.name, address: item.address, phone: item.phone, email: item.email, city: item.city, zone: item.zone, isActive: item.isActive !== false })),
      pagination: { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) },
      summary: { customerCount: allCount, personCount, companyCount, cityCount: cities.length },
      imports: imports.map(serializeCustomerImport), publications: publications.map(serializeCustomerPublication),
    });
  } catch (error) { return NextResponse.json({ error: error.message || "No se pudieron cargar los clientes." }, { status: 500 }); }
}
