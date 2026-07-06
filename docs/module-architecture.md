# Arquitectura modular

Este proyecto debe crecer como una plataforma interna integrada: una sola base de usuarios,
empleados, permisos y datos compartidos, con modulos separados por dominio.

## Regla principal

- `modules/{modulo}/` contiene la implementacion real del modulo: paginas, APIs, componentes, estilos, librerias, contratos y metadata.
- `app/` contiene solo rutas publicas de Next.js. Sus archivos deben ser wrappers delgados hacia `modules/{modulo}/pages`.
- `app/api/{modulo}/` contiene solo rutas publicas de API. Sus archivos deben ser wrappers delgados hacia `modules/{modulo}/api`.
- `components/` queda reservado para UI realmente global: botones, modales, tablas, inputs o shells usados por varios modulos.
- `lib/` queda reservado para infraestructura transversal: auth, db, auditoria y fecha/hora.
- `models/` contiene modelos Mongoose compartidos mientras se estabiliza la migracion. Cada modulo debe consumirlos mediante su propio contrato.

## Componentes globales

`components/` no debe contener componentes de negocio de un solo modulo. Se reserva para piezas
compartidas por varias pantallas o varios modulos:

- `components/auth/`: login, logout y elementos de sesion.
- `components/catalog/`: patrones reutilizables de pantallas tipo catalogo, drawers y loaders.
- `components/navigation/`: navegacion reutilizable.
- `components/shell/`: marcos compartidos para pantallas internas de modulos.
- `components/ui/`: piezas UI pequenas y genericas como modales, dialogos, avisos y campos reutilizables.

Si un componente solo se usa en Empresa, va en `modules/company/components`. Si solo se usa en
Planner, va en `modules/planner/components`.

## Modulos actuales

### Empresa

Responsable de la estructura base de la empresa:

- Empleados
- Usuarios
- Sucursales
- Areas
- Cargos o roles operativos
- Roles de acceso
- Organigrama y jerarquia futura

Carpetas actuales:

- `modules/company/`
- `modules/company/api/`
- `modules/company/components/`
- `modules/company/lib/`
- `modules/company/models/`
- `modules/company/pages/`
- `modules/company/styles/`
- `app/modules/company/`
- `app/api/company/`

Las rutas publicas de pagina viven bajo `app/modules/company/*` y las APIs bajo
`app/api/company/*` porque Next.js las resuelve por sistema de archivos, pero esos archivos
deben ser wrappers delgados hacia `modules/company`.
Ejemplo: `app/api/company/employees/route.js` delega en `modules/company/api/employees/route.js`.

No deben existir rutas paralelas como `app/company` o `app/api/employees` para recursos del
modulo Empresa.
Los consumidores deben usar `app/api/company/employees` y equivalentes.

### Planner

Responsable de plan operativo, asistencia relacionada al plan, cierres y nomina operativa:

- Programacion mensual
- Plantillas de horario
- Excepciones
- Vacaciones y ausencias planificadas
- Feriados
- Cruce planificado vs ejecutado
- Pre-nomina operativa y costos derivados

Carpetas actuales:

- `modules/planner/`
- `modules/planner/api/`
- `modules/planner/components/`
- `modules/planner/lib/`
- `modules/planner/models/`
- `modules/planner/pages/`
- `modules/planner/styles/`
- `app/api/planner/`
- `app/modules/planning/`

Las rutas publicas de pagina de Planner viven bajo `app/modules/planning/*`. No debe existir
una ruta paralela como `app/dashboard`.

Las APIs de Planner viven publicamente bajo `app/api/planner/*`, separadas por subdominio:

- `app/api/planner/planning/*`
- `app/api/planner/attendance/*`
- `app/api/planner/payroll/*`
- `app/api/planner/work-schedules`

No deben existir rutas paralelas como `app/api/planning`, `app/api/attendance` o `app/api/payroll`.

## Registro de modulos

El archivo `lib/modules/registry.js` es el punto central para mostrar los modulos disponibles
por usuario. Nuevos modulos deben registrarse ahi y exponer al menos:

- `key`
- `title`
- `href`
- `status`
- `description`
- `bullets`
- `icon`

## Fases recomendadas

1. Mantener las rutas actuales funcionando y ordenar el registro de modulos.
2. Separar cada dominio en `modules/{modulo}`.
3. Crear contratos por modulo para modelos usados: exports o adaptadores por dominio.
4. Migrar APIs antiguas a `/api/{modulo}/{recurso}` con wrappers temporales.
5. Migrar rutas visuales antiguas a `/modules/{modulo}` con redirecciones o rewrites controlados.
6. Agregar jerarquia y organigrama como subdominio de Empresa.
7. Convertir permisos en capacidades por modulo y accion.

## Criterio para ubicar archivos nuevos

- Si lo usa mas de un modulo, va en global.
- Si solo describe Empresa, va en `modules/company`.
- Si solo describe Planner, va en `modules/planner`.
- Si pertenece a asistencia operativa, va dentro de `modules/planner`.
- Si pertenece a pagos, calculos o cierres de nomina operativa, va dentro de `modules/planner`.
- Si es UI generica, va en `components/ui`.
