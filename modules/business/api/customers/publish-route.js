import { NextResponse } from "next/server";

import connectToDatabase from "@/lib/db/mongodb";
import { getBusinessAccess } from "@/modules/business/lib/access";
import { publishCustomerImport, serializeCustomerPublication } from "@/modules/business/lib/customer-publication";

export async function POST(_request, context) {
  const access = await getBusinessAccess("business.inventory.publish");
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });
  try {
    await connectToDatabase();
    const { id } = await context.params;
    const publication = await publishCustomerImport({ importId: id, user: access.user });
    return NextResponse.json({ message: `Clientes ${publication.version} publicados correctamente.`, publication: serializeCustomerPublication(publication) }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error.message || "No se pudieron publicar los clientes." }, { status: 400 }); }
}
