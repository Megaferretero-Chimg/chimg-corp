# Integración CHIMG Contingencia

## Alcance

El módulo web de Negocio administra el inventario que consume la aplicación local CHIMG Contingencia. La carga de Excel crea primero un borrador validable. Una caja solo puede descargar una publicación inmutable y nunca datos parciales del borrador.

Las bodegas publicables iniciales son exactamente:

- `ALMACÉN AMBATO`
- `ALMACÉN SALCEDO`
- `INTERNA`
- `EXTERNA`

Una bodega desconocida deja la importación en revisión y bloquea su publicación.

## Flujo administrativo

1. En `/modules/business/inventory`, cargar el Excel e indicar la fecha de generación empresarial.
2. Revisar errores, productos, bodegas y existencias detectadas.
3. Publicar el borrador validado. La operación asigna una versión `YYYYMMDD-##`, genera el JSON determinista, calcula SHA-256 y guarda el paquete por fragmentos en MongoDB dentro de una transacción.
4. En `/modules/business/devices`, crear un código temporal para una caja y una bodega. El código es de un solo uso.
5. En `/modules/business/sync`, revisar guías y clientes recibidos, y cambiar su estado administrativo.

Las publicaciones conservan el historial. Una publicación nueva marca la anterior como `superseded`, pero la versión anterior sigue disponible por su URL exacta. Los campos de contenido, checksum y versión de una publicación no pueden modificarse después de creada.

## Autenticación de dispositivos

La activación recibe un UUID persistente generado por la app local. El servidor devuelve el token solo una vez; en MongoDB se guarda únicamente su SHA-256. Todos los endpoints de sincronización requieren:

```http
Authorization: Bearer <accessToken>
```

Un token inválido recibe `401`; un dispositivo revocado recibe `403`. La activación y la autenticación de dispositivos tienen rate limiting persistido en MongoDB con expiración TTL.

## Contrato HTTP

La URL base de producción es `https://chimg-corp.vercel.app`.

### Activar dispositivo

`POST /api/v1/devices/activate`

```json
{
  "activationCode": "ABC123",
  "deviceId": "b6b4c068-dfee-4f39-b603-b6cfec5a90d6",
  "deviceName": "CAJA AMBATO 01"
}
```

Respuesta `200`:

```json
{
  "deviceId": "b6b4c068-dfee-4f39-b603-b6cfec5a90d6",
  "deviceName": "CAJA AMBATO 01",
  "warehouse": "ALMACÉN AMBATO",
  "accessToken": "chimg_..."
}
```

El nombre y la bodega efectivos son los autorizados por el administrador al crear el código. El código inválido, vencido o reutilizado recibe `401`.

### Consultar manifiesto

`GET /api/v1/sync/manifest`

```json
{
  "inventory": {
    "version": "20260824-01",
    "checksum": "<sha256-hex>",
    "generatedAt": "2026-08-24T10:10:00-05:00",
    "downloadUrl": "/api/v1/sync/packages/inventory/20260824-01"
  }
}
```

El manifiesto usa `Cache-Control: no-store`. Si todavía no hay publicación, `inventory` es `null`.

### Descargar inventario

`GET /api/v1/sync/packages/inventory/{version}`

```json
{
  "version": "20260824-01",
  "generatedAt": "2026-08-24T10:10:00-05:00",
  "products": [
    {
      "code": "PROD-001",
      "barcode": "786100000001",
      "description": "PRODUCTO",
      "price": 10,
      "taxRate": 15,
      "active": true,
      "stocks": [
        { "warehouse": "ALMACÉN AMBATO", "quantity": 25 }
      ]
    }
  ]
}
```

La app debe calcular SHA-256 sobre los bytes exactos descargados y compararlo con el manifiesto o con `X-Content-SHA256`. Una discrepancia obliga a descartar el archivo. La respuesta incluye `ETag` y `Cache-Control: public, max-age=31536000, immutable`. Una versión inexistente o no publicada recibe `404`.

### Enviar lote local

`POST /api/v1/sync/batch`

```json
{
  "deviceId": "b6b4c068-dfee-4f39-b603-b6cfec5a90d6",
  "guides": [
    {
      "syncUuid": "a9908e8c-6577-47c8-a769-24bba044ed30",
      "internal_number": "CONT-0001",
      "warehouse": "ALMACÉN AMBATO",
      "cashier_name": "CAJERO",
      "seller_name": "VENDEDOR",
      "customer_identification": "1800000001",
      "customer_name": "CLIENTE",
      "total": 11.5,
      "created_at": "2026-08-24T10:30:00-05:00",
      "items": [
        {
          "product_code": "PROD-001",
          "description": "PRODUCTO",
          "quantity": 1,
          "unit_price": 10,
          "total": 11.5
        }
      ]
    }
  ],
  "pendingCustomers": [
    {
      "syncUuid": "3b78108e-42e5-49bf-a154-21c250bc1cc8",
      "identification": "1800000002",
      "name": "CLIENTE PENDIENTE",
      "city": "AMBATO",
      "created_at": "2026-08-24T10:20:00-05:00"
    }
  ]
}
```

Respuesta `200`, incluso si una parte del lote tiene errores:

```json
{
  "accepted": ["a9908e8c-6577-47c8-a769-24bba044ed30"],
  "duplicates": [],
  "rejected": [
    { "uuid": "", "error": "syncUuid de la guía no es un UUID válido." }
  ]
}
```

La idempotencia se garantiza por `syncUuid`: reenviar un registro aceptado lo coloca en `duplicates` sin duplicarlo. El `deviceId` del cuerpo debe coincidir con el token; de lo contrario se responde `403`. El máximo es 200 registros combinados por lote.

## Base de datos y despliegue

No se usa almacenamiento permanente del filesystem de Vercel. Los borradores, metadatos y fragmentos inmutables de paquetes se guardan en MongoDB. La publicación usa transacciones, por lo que MongoDB debe operar como replica set o clúster compatible.

No se agregaron variables de entorno: se reutilizan `MONGODB_URI` y `SESSION_SECRET`. `SESSION_SECRET` también protege mediante HMAC los códigos de activación.

Aplicar índices y sembrar las cuatro bodegas:

```bash
npm run migrate:business-sync
```

Ejecutar la prueba integral contra un servidor local:

```bash
npm run dev
npm run test:business-sync
```

Opcionalmente se puede definir `BUSINESS_SYNC_BASE_URL` para apuntar la prueba a otra instancia. La prueba crea datos identificados como integración y no debe ejecutarse contra producción sin aceptar esos registros de prueba.

## Diferencias relevantes respecto al contrato local

- El inventario se distribuye como un único JSON versionado, no como consultas por producto.
- Los nombres de bodega están normalizados con tildes en `ALMACÉN AMBATO` y `ALMACÉN SALCEDO`.
- `generatedAt` siempre incluye el offset Ecuador `-05:00`.
- El servidor acepta `syncUuid` en guías; por compatibilidad también reconoce `uuid` como alternativa, pero se recomienda enviar `syncUuid`.
- Los campos adicionales de una guía o cliente se preservan en un snapshot para conciliación, aunque el panel use solo los campos normalizados.
