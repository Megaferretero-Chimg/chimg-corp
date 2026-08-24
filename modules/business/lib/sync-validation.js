import { isUuid } from "@/modules/business/lib/device-auth";

function text(value) {
  return String(value ?? "").trim();
}

function nonNegativeNumber(value, label, errors) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) errors.push(`${label} debe ser un número no negativo.`);
  return Number.isFinite(number) ? number : 0;
}

function validDate(value, label, errors) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) errors.push(`${label} no es una fecha válida.`);
  return parsed;
}

export function validateGuide(input, device) {
  const errors = [];
  const syncUuid = text(input?.syncUuid || input?.uuid);
  if (!isUuid(syncUuid)) errors.push("syncUuid de la guía no es un UUID válido.");
  if (text(input?.device_id) && text(input.device_id) !== device.deviceId) errors.push("device_id no corresponde al dispositivo autenticado.");
  if (!text(input?.internal_number)) errors.push("internal_number es obligatorio.");
  const createdAt = validDate(input?.created_at, "created_at", errors);
  const total = nonNegativeNumber(input?.total, "total", errors);
  const items = Array.isArray(input?.items) ? input.items : [];
  if (!items.length) errors.push("La guía debe incluir al menos un producto.");

  items.forEach((item, index) => {
    if (!text(item?.product_code)) errors.push(`items[${index}].product_code es obligatorio.`);
    if (!text(item?.description)) errors.push(`items[${index}].description es obligatoria.`);
    nonNegativeNumber(item?.quantity, `items[${index}].quantity`, errors);
    nonNegativeNumber(item?.unit_price, `items[${index}].unit_price`, errors);
    nonNegativeNumber(item?.total, `items[${index}].total`, errors);
  });

  return {
    syncUuid,
    errors,
    document: {
      syncUuid,
      device: device._id,
      deviceId: device.deviceId,
      internalNumber: text(input?.internal_number),
      warehouse: text(input?.warehouse).toUpperCase(),
      cashierName: text(input?.cashier_name),
      sellerName: text(input?.seller_name),
      customerIdentification: text(input?.customer_identification),
      customerName: text(input?.customer_name),
      total,
      localCreatedAt: createdAt,
      receivedAt: new Date(),
      status: "pending",
      snapshot: input,
    },
  };
}

export function validatePendingCustomer(input, device) {
  const errors = [];
  const syncUuid = text(input?.syncUuid);
  if (!isUuid(syncUuid)) errors.push("syncUuid del cliente no es un UUID válido.");
  const identification = text(input?.identification);
  const name = text(input?.name || `${text(input?.first_names)} ${text(input?.last_names)}`);
  if (!identification) errors.push("identification es obligatoria.");
  if (!name) errors.push("name es obligatorio.");
  const createdAt = validDate(input?.created_at, "created_at", errors);

  return {
    syncUuid,
    errors,
    document: {
      syncUuid,
      device: device._id,
      deviceId: device.deviceId,
      identification,
      name,
      city: text(input?.city),
      localCreatedAt: createdAt,
      receivedAt: new Date(),
      status: "pending",
      snapshot: input,
    },
  };
}
