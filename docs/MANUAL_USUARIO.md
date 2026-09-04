# Manual de Usuario
## Tu Plan Seguro CRM

Tu Plan Seguro CRM te permite administrar en un solo lugar:

- Clientes y prospectos
- Familias / hogares
- Pólizas
- Información de salud
- Tareas
- Primas (seguimiento de pago)
- Comisiones
- Cumpleaños
- Documentos
- Información migratoria
- Reportes

Este manual explica cómo usar el CRM en el trabajo diario. No necesitas conocimientos técnicos para seguirlo.

---

## Índice

1. [Inicio de sesión](#1-inicio-de-sesión)
2. [Menú principal](#2-menú-principal)
3. [Dashboard](#3-dashboard)
4. [Contactos](#4-contactos)
5. [Ficha del contacto](#5-ficha-del-contacto)
6. [Familia / Hogar](#6-familia--hogar)
7. [Pólizas](#7-pólizas)
8. [Salud](#8-salud)
9. [Medicamentos y médicos/proveedores preferidos](#9-medicamentos-y-médicosproveedores-preferidos)
10. [Información migratoria](#10-información-migratoria)
11. [SSN](#11-ssn)
12. [USCIS / A-Number](#12-uscis--a-number)
13. [Documentos migratorios](#13-documentos-migratorios)
14. [Tareas](#14-tareas)
15. [Primas](#15-primas)
16. [Comisiones](#16-comisiones)
17. [Conciliación de comisiones](#17-conciliación-de-comisiones)
18. [Cumpleaños](#18-cumpleaños)
19. [Documentos de póliza](#19-documentos-de-póliza)
20. [Historial](#20-historial)
21. [Reportes](#21-reportes)
22. [Exportar CSV](#22-exportar-csv)
23. [Búsqueda global](#23-búsqueda-global)
24. [Usuarios y roles](#24-usuarios-y-roles)
25. [Configuración](#25-configuración)
26. [Actividad de usuarios](#26-actividad-de-usuarios)
27. [Ejemplo: Registrar un cliente nuevo](#27-ejemplo-registrar-un-cliente-nuevo)
28. [¿Qué revisar cada día?](#28-qué-revisar-cada-día)
29. [Recuerda](#29-recuerda)
30. [Problemas frecuentes](#30-problemas-frecuentes)

---

## 1. Inicio de sesión

[CAPTURA: Pantalla de inicio de sesión]

Para entrar al CRM:

1. Abre la dirección del CRM en tu navegador.
2. Escribe tu **correo electrónico**.
3. Escribe tu **contraseña**.
4. Presiona **Iniciar sesión**.

Si el correo o la contraseña son incorrectos, el sistema te lo indica y no te deja entrar. Verifica que no tengas mayúsculas o espacios de más y vuelve a intentar.

No existe una pantalla de "Registrarme" — solo un Administrador puede crear cuentas nuevas (ver [Usuarios y roles](#24-usuarios-y-roles)).

---

## 2. Menú principal

El menú de la izquierda te lleva a cada módulo del CRM:

| Opción | Para qué sirve |
|---|---|
| **Dashboard** | Resumen de lo que necesita tu atención hoy. |
| **Contactos** | Clientes y prospectos. |
| **Pólizas** | Seguros registrados. |
| **Tareas** | Actividades pendientes. |
| **Comisiones** | Comisiones esperadas y recibidas (no visible para Asistentes). |
| **Primas / Pagos** | Seguimiento de pagos de las pólizas. |
| **Cumpleaños** | Clientes y familiares que cumplen años. |
| **Reportes** | Listados de cartera para filtrar y exportar. |
| **Configuración** | Administración de usuarios, compañías y productos. |

Arriba a la derecha siempre tienes una caja de **Buscar…** (ver [Búsqueda global](#23-búsqueda-global)) y tu nombre de usuario, desde donde puedes **Cerrar sesión**.

Algunas opciones pueden no estar disponibles según tu rol — ver [Usuarios y roles](#24-usuarios-y-roles).

---

## 3. Dashboard

[CAPTURA: Dashboard]

Al entrar, el Dashboard te muestra lo que necesita tu atención **hoy**:

- **Hoy**: cuántas tareas tienes para hoy, cuántas están vencidas, cuántos pagos están vencidos y cuántos clientes requieren asistencia para pagar.
- **Tareas prioritarias**: una lista corta de tus tareas más urgentes.
- **Primas y pagos**: cuántos pagos vencen hoy, en los próximos 7 días, y cuántos ya están vencidos.
- **Cumpleaños**: si hay cumpleaños hoy o próximos.
- **Cartera**: cuántas pólizas activas y pendientes tienes.
- **Comisiones** (si tu rol lo permite): esperado, recibido y diferencia del período actual.

La mayoría de los elementos del Dashboard se pueden presionar para ir directamente al cliente, tarea o póliza correspondiente.

---

## 4. Contactos

[CAPTURA: Contactos]

En **Contactos** ves el listado completo de clientes y prospectos.

- **Buscar**: escribe nombre, teléfono o correo y presiona **Filtrar**.
- **Estado**: filtra por Prospecto, Cliente, Ex cliente u Otro.
- **+ Nuevo contacto**: crea un contacto nuevo.
- **Exportar CSV**: descarga el listado (ver [Exportar CSV](#22-exportar-csv)).
- **Ver**: abre la ficha completa del contacto.

**Prospecto** es alguien que todavía no es cliente activo; **Cliente** es alguien con quien ya tienes una relación comercial activa. **Todo contacto nuevo nace como Prospecto** y el sistema lo cambia automáticamente a **Cliente** en cuanto queda cubierto por al menos una póliza activa — y de vuelta a Prospecto si deja de estarlo (por ejemplo, si esa póliza se cancela). Un mismo contacto puede pasar de Prospecto a Cliente sin perder su historial — nunca se crea un registro duplicado, y nunca necesitas cambiar el Estado a mano. Los estados **Ex cliente** y **Otro** sí son decisiones manuales tuyas (se editan desde **Editar**) y el sistema nunca los sobrescribe automáticamente.

### Crear un contacto

1. Presiona **+ Nuevo contacto**.
2. Completa Nombre, Apellido y los datos que tengas disponibles (teléfono, correo, fecha de nacimiento, sexo).
3. Si corresponde, elige el Agente asignado.
4. Presiona **Crear contacto**. El contacto queda como Prospecto — el Estado se vuelve Cliente solo, automáticamente, cuando le agregues una póliza activa.

Para editar un contacto ya existente (incluyendo marcarlo como Ex cliente/Otro), ábrelo y presiona **Editar**.

---

## 5. Ficha del contacto

Al abrir un contacto (botón **Ver**) encuentras estas pestañas:

| Pestaña | Contenido |
|---|---|
| **Resumen** | Datos personales, agente asignado, hogar y actividad reciente. |
| **Familia** | Hogar del contacto y sus miembros. |
| **Pólizas** | Pólizas donde este contacto es titular o miembro cubierto. |
| **Salud** | Detalle de pólizas de Salud, medicamentos y médicos/proveedores. |
| **Identidad** | Categoría migratoria, SSN, USCIS/A-Number y documentos migratorios. |
| **Tareas** | Tareas relacionadas con este contacto. |
| **Comisiones** | Comisiones ligadas a sus pólizas (no visible para Asistentes). |
| **Notas** | Notas manuales escritas por el equipo. |
| **Historial** | Registro automático de qué cambió, quién y cuándo. |

[CAPTURA: Ficha del contacto]

---

## 6. Familia / Hogar

Un contacto puede pertenecer a un **hogar** — el grupo familiar con el que comparte dirección e ingreso familiar.

[CAPTURA: Familia]

### Crear un hogar

1. En la pestaña **Familia**, presiona **Crear hogar**.
2. (Opcional) escribe un nombre para el hogar.
3. Elige el rol de esta persona en el hogar (normalmente **Titular del hogar**).
4. Presiona **Crear hogar**.

### Agregar familiares

1. Presiona **Agregar miembro**.
2. Busca un contacto ya existente, o crea uno nuevo directamente desde el mismo diálogo.
3. Elige su rol: **Titular del hogar**, **Esposo/a**, **Hijo/a**, **Dependiente** u **Otro**.
4. Guarda.

También puedes registrar la dirección del hogar y el ingreso familiar estimado desde esta misma pestaña.

> **Importante**: agregar a alguien al hogar **no** significa que esté cubierto por una póliza. Son dos cosas distintas — el hogar es el grupo familiar; la cobertura de una póliza se define aparte, al crear o editar esa póliza (ver [Pólizas](#7-pólizas)).

---

## 7. Pólizas

[CAPTURA: Póliza]

### Crear una póliza

1. Ve a **Pólizas → + Nueva póliza**.
2. Busca y selecciona al **titular** (la persona dueña de la póliza).
3. Elige el **Tipo de seguro** y la **Compañía** para filtrar el producto (opcional), luego elige el **Producto**.
4. Indica si el **titular está cubierto** por esta póliza (Sí/No).
5. Marca qué otras personas del hogar quedan cubiertas, y su rol dentro de la póliza.
6. Completa Número de póliza, Estado, Fecha efectiva, Fecha de terminación, Prima, Frecuencia de pago y los demás datos disponibles.
7. Presiona **Crear póliza**.

### Desde el detalle de una póliza puedes

- **Editar**: cambiar sus datos.
- **Renovar póliza**: crea una póliza **nueva**, vinculada a la anterior, sin modificar la original.
- **Cancelar póliza**: pide una fecha de terminación y un motivo opcional; la póliza pasa a Cancelada pero **nunca se borra** — miembros, documentos, información de salud, comisiones y notas se conservan.
- **+ Agregar miembro** / **Quitar de la póliza**: administrar quién está cubierto.
- **Editar seguimiento de pago** y marcar el estado de pago (**Marcar al día**, **Marcar por vencer**, **Marcar vencido**).

> **Importante**: el hogar de una póliza y los **miembros cubiertos** son cosas distintas. Una póliza puede estar vinculada a un hogar de 5 personas y cubrir solo a 2 de ellas.

---

## 8. Salud

[CAPTURA: Salud]

Para pólizas de tipo Salud, desde la pestaña **Salud** de la póliza (**Agregar información de salud** / **Editar**) puedes registrar:

- **Marketplace**: Application ID y estado (si aplica).
- **Plan**: nombre del plan tal como aparece en el documento oficial.
- **Financiero Marketplace**: crédito fiscal (subsidio) e ingreso utilizado en la solicitud.
- **Cost sharing**: deducible individual/familiar y out-of-pocket individual/familiar.

Solo se pide la información que el CRM realmente tiene espacio para guardar — si un dato no aplica, se deja en blanco.

---

## 9. Medicamentos y médicos/proveedores preferidos

Desde la pestaña **Salud** del contacto (siempre visible, aunque todavía no tenga ninguna póliza de Salud):

- **+ Agregar medicamento**: nombre (obligatorio), dosis, frecuencia y notas (opcionales).
- **+ Agregar proveedor**: tipo (PCP, Especialista u Otro), nombre (obligatorio), especialidad, teléfono, organización y notas (opcionales).

Puedes editar cualquiera de los dos en cualquier momento. "Eliminar" un medicamento lo desactiva (queda fuera de la lista, pero su historial se conserva); "Eliminar" un proveedor sí lo borra.

Esta sección es solo para uso operativo del equipo (saber qué medicamentos toma un cliente o a qué médico prefiere) — no reemplaza ni interpreta información médica clínica.

---

## 10. Información migratoria

[CAPTURA: Información migratoria]

Desde la pestaña **Identidad** del contacto puedes registrar su categoría migratoria:

- **Ciudadano estadounidense**
- **Residente permanente**
- **Autorización de empleo**
- **Otra categoría**
- **No especificado**

Para cambiarla, elige la opción en el selector y presiona **Guardar**.

> Esta información es **administrativa** — ayuda al equipo a saber qué tipo de documentación maneja cada cliente. El CRM **no** determina automáticamente si un cliente es elegible para Marketplace, subsidio o Medicaid a partir de esta categoría; esa evaluación la hace el agente con las reglas vigentes.

---

## 11. SSN

El CRM puede guardar el Número de Seguro Social (SSN) de un cliente cuando lo necesites para una operación en Marketplace.

### Registrar

1. En la pestaña **Identidad**, presiona **Registrar SSN**.
2. Escribe el número (ej. `123-45-6789`).
3. Presiona **Guardar**.

Después de guardarlo, el CRM **siempre lo muestra protegido** por defecto:

```
***-**-6789
```

### Mostrar, copiar y ocultar

- **Mostrar**: revela el número completo en pantalla, solo mientras lo necesites.
- **Copiar**: copia el número al portapapeles para pegarlo en Marketplace u otro sistema, sin tener que escribirlo a mano.
- **Ocultar**: vuelve a protegerlo. Si recargas la página o sales de la pantalla, también vuelve a mostrarse protegido automáticamente.

### Reemplazar o eliminar

- **Reemplazar SSN**: te permite escribir un número nuevo. El sistema nunca te muestra el anterior en el formulario, para evitar exponerlo sin necesidad.
- **Eliminar**: borra el SSN registrado (pide confirmación).

> Ni el ejemplo de este manual (`123-45-6789`) ni ningún otro SSN real debe compartirse, imprimirse o guardarse fuera del CRM.

---

## 12. USCIS / A-Number

Igual que el SSN, el **USCIS / A-Number** se guarda protegido y se revela solo bajo demanda:

- **Registrar USCIS / A-Number** → escribe el número → **Guardar**.
- Se muestra protegido por defecto (ej. `*****6789`).
- **Mostrar** / **Copiar** / **Ocultar**, igual que el SSN.
- **Reemplazar USCIS / A-Number** / **Eliminar**, igual que el SSN.

**USCIS / A-Number** y **Número de documento** (ver siguiente sección) son campos **diferentes** dentro del CRM: el A-Number es el identificador que USCIS asigna a la persona; el número de documento es el que aparece impreso en su tarjeta o permiso específico. Pueden coincidir o no, según el caso.

Este manual no es asesoría migratoria — solo explica cómo registrar estos datos en el sistema.

---

## 13. Documentos migratorios

Desde la pestaña **Identidad**, sección **Documentos migratorios**, puedes registrar:

- **Tarjeta de residente permanente**
- **Permiso de trabajo / EAD**
- **Otro**

### Registrar un documento

1. Presiona **+ Agregar documento**.
2. Elige el tipo de documento.
3. Escribe el número del documento (opcional).
4. Escribe la fecha de emisión y/o vencimiento si las tienes (formato `MM/DD/AAAA`) — ninguna de las dos es obligatoria.
5. Presiona **Agregar documento**.

El número, igual que el SSN y el USCIS/A-Number, aparece **enmascarado por defecto** (ej. `******9876`), con sus propios botones **Mostrar** / **Copiar** / **Ocultar**.

Desde cada documento puedes **Editar** sus datos o **Desactivar** el documento (por ejemplo, si venció y fue reemplazado) sin perder su historial.

---

## 14. Tareas

[CAPTURA: Tareas]

Las tareas te ayudan a llevar el seguimiento de pendientes: llamar a un cliente, pedir documentos, confirmar un pago, etc.

### Crear una tarea

1. Ve a **Tareas → + Nueva tarea**.
2. Escribe un título (y descripción si quieres).
3. Elige la Prioridad (Baja, Normal, Alta, Urgente).
4. Elige la fecha y hora de vencimiento — formato `MM/DD/AAAA` y hora en formato `hh:mm AM/PM`.
5. Elige el responsable (si tu rol lo permite).
6. Presiona **Crear tarea**.

El listado de Tareas se puede filtrar por pestaña: **Todas**, **Hoy**, **Vencidas**, **Pendientes**, **Completadas** — además de buscar por título, estado, prioridad y responsable.

Desde el detalle de una tarea puedes **Editar**, **Completar** o **Cancelar**.

---

## 15. Primas

[CAPTURA: Primas]

**Primas / Pagos** te muestra el seguimiento de pago de cada póliza: prima, frecuencia, próximo pago, estado de pago y si el cliente necesita asistencia para pagar.

Pestañas rápidas: **Todas**, **Vencen hoy**, **Próximos 7 días**, **Próximos 30 días**, **Vencidas**.

Desde el detalle de una póliza, botón **Editar seguimiento de pago**, puedes actualizar estos datos o marcar el estado directamente: **Marcar al día**, **Marcar por vencer**, **Marcar vencido**.

Este módulo no reemplaza los pagos reales — es un seguimiento manual de en qué estado está cada cobro.

---

## 16. Comisiones

[CAPTURA: Comisiones]

> Este módulo no está disponible para el rol Asistente.

Para cada período (mes) y póliza, el CRM distingue entre:

- **Esperado**: cuánto se espera recibir por esa póliza ese mes.
- **Recibido**: cuánto se ha recibido realmente (puede ser en varios pagos).
- **Diferencia**: Recibido − Esperado.

Puedes filtrar por período, agente, compañía y estado, y **Exportar CSV** del listado.

Desde el detalle de una comisión esperada puedes registrar movimientos (pagos, chargebacks, ajustes) manualmente cuando no vienen de un reporte de conciliación.

Las **reglas de comisión** (cuánto corresponde por cada producto) se administran desde Configuración → Productos, o como excepción sobre una póliza específica.

---

## 17. Conciliación de comisiones

[CAPTURA: Conciliar pagos de comisiones]

Desde **Comisiones → Conciliar pagos** puedes comparar lo esperado contra un reporte real que te entrega una agencia o compañía.

### Flujo

1. Elige la fuente/formato del reporte y **sube el archivo** (CSV o XLSX).
2. El sistema muestra una **vista previa** — nunca registra nada automáticamente todavía.
3. Revisa las coincidencias encontradas.
4. Resuelve manualmente los casos pendientes o ambiguos (elige a qué cliente/póliza corresponde cada fila).
5. Revisa las columnas **Esperado / Recibido / Diferencia** de cada fila.
6. **Confirma** para aplicar — recién en este paso se registran los pagos.

El sistema interpreta el monto recibido según el formato del reporte que estés usando — por ejemplo, algunos reportes traen columnas adicionales (como asistencia) que no forman parte del monto de comisión y el sistema las trata por separado, nunca como un descuento automático de tu comisión.

Subir el mismo reporte dos veces no duplica los pagos ya aplicados.

---

## 18. Cumpleaños

Desde **Cumpleaños** ves quién cumple años entre tus clientes y sus familiares (no solo el titular).

Pestañas: **Todos**, **Hoy**, **Este mes**, **Mes siguiente**, **Próximos**. "Mes siguiente" te deja adelantarte y preparar tarjetas del mes que viene (por ejemplo, revisar octubre estando en septiembre).

Por cada persona puedes:

- **Marcar enviada**: registrar que ya se le envió la felicitación (y por qué medio, si quieres registrarlo).
- **Omitir este año**: marcar que este año no se le enviará tarjeta.

---

## 19. Documentos de póliza

Desde el detalle de una póliza, sección **Documentos**:

1. Elige el **Tipo** de documento (Resumen del plan, Brochure, Listado de medicamentos, Directorio de proveedores, Tarjeta / ID, Solicitud, Otro).
2. (Opcional) agrega una descripción.
3. Selecciona el archivo (PDF, PNG, JPG o WEBP, máximo 15 MB).
4. Presiona **Subir documento**.

Puedes ver y eliminar los documentos ya cargados desde la misma sección. Los archivos nunca quedan expuestos con un enlace público — siempre se descargan verificando primero que tienes acceso a esa póliza.

---

## 20. Historial

[CAPTURA: Historial]

Cada contacto y cada póliza tienen una pestaña **Historial** — un registro automático de:

- **Qué** cambió (ej. "Póliza actualizada", "SSN registrado").
- **Quién** hizo el cambio.
- **Cuándo** ocurrió.

Puedes filtrar el Historial por categoría (Contacto, Familia, Pólizas, Salud, Tareas, Notas, Primas, Comisiones, Documentos) y presionar **Ver cambios** cuando esté disponible para ver el detalle de un cambio puntual.

> Información especialmente sensible como el **SSN o el USCIS/A-Number nunca aparece completa en el Historial** — solo verás que "se registró" o "se consultó", nunca el número.

---

## 21. Reportes

[CAPTURA: Reportes]

**Reportes → Clientes** te da una vista de cartera para filtrar y exportar, sin tener que abrir contacto por contacto.

Filtros disponibles: buscar por nombre/teléfono/correo, Estado del contacto, Agente, Estado (US), Categoría migratoria, Tipo de póliza, Compañía, Con póliza activa, Vencen en 30 días. Puedes elegir cuántos resultados ver por página (25/50/100).

Cada fila te muestra un resumen (agente, ubicación, categoría migratoria, hogar, pólizas activas, compañía/tipo, vigencia, última actividad) y un botón **Ver** para abrir la ficha completa del contacto.

**Reportes → Pólizas** y **Reportes → Comisiones** te llevan a los listados de Pólizas y Comisiones ya existentes, con sus propios filtros.

---

## 22. Exportar CSV

El botón **Exportar CSV** descarga un listado (Contactos, Pólizas, Comisiones o el Reporte de clientes) en un archivo que puedes abrir con Excel o Google Sheets.

El CSV **respeta los filtros** que tengas activos en pantalla en ese momento.

> Por seguridad, el CSV **nunca incluye** SSN, USCIS/A-Number, números de documento migratorio, ni datos bancarios/tarjeta. Si necesitas ese dato puntual, ábrelo desde la ficha del contacto con **Mostrar**.

---

## 23. Búsqueda global

La caja **Buscar…** en la parte superior (visible en cualquier pantalla) te permite encontrar rápidamente un contacto por nombre, teléfono o correo, o una póliza por su número, compañía o producto.

Presiona **Enter** o el botón de búsqueda para ver los resultados agrupados en "Contactos" y "Pólizas"; presiona sobre un resultado para abrirlo.

> La búsqueda global **no** encuentra clientes por SSN, USCIS/A-Number ni número de documento — esos datos nunca son buscables, ni siquiera por un Administrador.

---

## 24. Usuarios y roles

El CRM tiene tres roles:

| Rol | Puede hacer |
|---|---|
| **Administrador** | Acceso completo: todos los módulos, gestión de usuarios, revelar SSN/USCIS de cualquier contacto. |
| **Agente** | Ve y trabaja con sus propios clientes/pólizas asignados (y los sin asignar); puede revelar SSN/USCIS solo de los contactos a los que tiene acceso. |
| **Asistente** | Sin acceso al módulo de Comisiones; puede ver la información migratoria de un contacto **enmascarada**, pero nunca puede revelar el SSN, el USCIS/A-Number ni un número de documento. |

Si una opción del menú o un botón no aparece para ti, es porque tu rol no tiene acceso a esa función — no es un error.

---

## 25. Configuración

Desde **Configuración** (según tu rol) puedes administrar:

- **Usuarios**: crear nuevos usuarios del CRM (nombre, correo, rol), y activar/desactivar cuentas existentes.
- **Compañías**: administrar las aseguradoras (carriers) disponibles para crear pólizas.
- **Productos**: administrar los productos/planes de cada compañía y su tipo de seguro.

### Crear un usuario

1. Ve a **Configuración → Usuarios**.
2. Completa Nombre completo, Correo electrónico y Rol.
3. Presiona **Crear usuario**.
4. El sistema te muestra una **contraseña temporal una sola vez** — cópiala y compártela con esa persona por un medio seguro (no queda guardada en ningún otro lugar del CRM).

### Restablecer la contraseña de un usuario

Solo un Administrador puede hacerlo, y nunca puede ver la contraseña actual de nadie — solo establecer una nueva.

1. Ve a **Configuración → Usuarios**.
2. En la fila del usuario, presiona **Restablecer contraseña**.
3. Escribe la nueva contraseña (mínimo 10 caracteres) y confírmala.
4. Comparte la nueva contraseña con esa persona por un medio seguro. La contraseña anterior deja de funcionar de inmediato y esa persona deberá volver a iniciar sesión.

Un Administrador nunca puede desactivar su propia cuenta (ni la del último Administrador activo del sistema) — evita quedar todos bloqueados por error.

---

## 26. Actividad de usuarios

Solo para **Administradores**: en **Configuración → Usuarios**, cada fila tiene un enlace **Ver actividad**, que muestra el historial de acciones realizadas por ese usuario (qué hizo y cuándo), con la misma protección de datos sensibles que el resto del Historial.

---

## 27. Ejemplo: Registrar un cliente nuevo

Un flujo completo, usando un cliente ficticio de ejemplo, **María Ejemplo**:

1. **Crear contacto**: Contactos → + Nuevo contacto → Nombre "María", Apellido "Ejemplo", teléfono y correo de contacto, Estado "Cliente".
2. **Crear hogar**: en la ficha de María, pestaña Familia → Crear hogar → "Familia Ejemplo", María como Titular del hogar.
3. **Agregar familiares**: Agregar miembro → crear un contacto nuevo para su esposo, rol "Esposo/a" (repite para hijos/dependientes si aplica).
4. **Crear póliza**: Pólizas → + Nueva póliza → buscar a María como titular → elegir producto → confirmar si María está cubierta → marcar qué familiares también quedan cubiertos → completar número de póliza, estado, fechas y prima.
5. **Registrar información de salud** (si la póliza es de Salud): desde la póliza, Agregar información de salud → completar los campos que apliquen.
6. **Registrar información migratoria** (si corresponde): pestaña Identidad de María → elegir categoría migratoria → registrar SSN/USCIS/A-Number si el trabajo lo requiere.
7. **Crear tarea de seguimiento**: Tareas → + Nueva tarea → "Confirmar documentos de inscripción" → fecha/hora → asignar al agente responsable.

Con esto, María queda completamente registrada: contacto, hogar, póliza con miembros cubiertos, información de salud, información migratoria y una tarea de seguimiento.

---

## 28. ¿Qué revisar cada día?

1. **Dashboard** — panorama general.
2. **Tareas** vencidas y de hoy.
3. **Primas** pendientes o por vencer.
4. Clientes que **necesitan asistencia** para pagar.
5. **Cumpleaños** del día.
6. **Pólizas** próximas a vencer.
7. **Comisiones** pendientes (si tu rol lo permite).

---

## 29. Recuerda

- No compartas tu contraseña con nadie.
- Verifica bien antes de guardar información sensible (SSN, USCIS/A-Number, números de documento) — puedes editarla después, pero hazlo con cuidado.
- No agregues un familiar a una póliza si en realidad no está cubierto por ella.
- Revisa cuidadosamente una conciliación de comisiones antes de confirmarla — una vez aplicada, no se puede deshacer sola.
- Usa el Historial cuando necesites saber qué cambió, quién lo hizo y cuándo.
- Cierra sesión cuando uses una computadora compartida.

---

## 30. Problemas frecuentes

**No encuentro un cliente**
Usa la caja de Buscar… arriba, o ve a Contactos y prueba buscando solo por una parte del nombre, teléfono o correo. Si sigue sin aparecer, puede que esté registrado con otro dato (por ejemplo, un apodo distinto).

**No puedo ver Comisiones**
Ese módulo no está disponible para el rol Asistente. Si crees que debería tener acceso, consulta con tu Administrador.

**No puedo revelar un SSN**
Revelar SSN/USCIS/A-Number requiere que tengas acceso operativo a ese contacto (estar asignado a él, o que no tenga agente asignado). El rol Asistente nunca puede revelar estos datos, aunque pueda ver el contacto.

**No veo un familiar al agregarlo a una póliza**
Solo aparecen como candidatos los miembros del hogar al que esa póliza está vinculada. Verifica en la pestaña Familia que la persona ya esté agregada al hogar correspondiente.

**No puedo activar una póliza**
Una póliza en estado "Activa" necesita tener una fecha efectiva. Verifica que ese campo esté completo.

**El archivo de conciliación no encuentra coincidencia**
Puede que el nombre del cliente en el reporte no coincida exactamente con el registrado en el CRM, o que la póliza no tenga una comisión esperada generada para ese período. Usa la resolución manual de la vista previa para vincular la fila correcta a mano.

---

*Para documentación técnica del sistema (arquitectura, base de datos, seguridad), consulta los demás archivos en la carpeta `docs/` del proyecto — este manual es solo para el uso diario del CRM.*
