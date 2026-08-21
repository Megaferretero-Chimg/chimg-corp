import { redirect } from "next/navigation";

import { businessModulePath } from "@/modules/business/routes";

export default function BusinessRootPage() {
  redirect(businessModulePath("/home"));
}
