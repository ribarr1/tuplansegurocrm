# Checklist de prueba funcional manual (UAT) — Fase 019.5 / 019.6 / 019.7 / 019.8 / 019.9

Lista de pruebas para que el dueño de TuPlanSeguro USA verifique el CRM de punta a punta, con datos de prueba (nunca el Excel real todavía). Marcar cada punto al probarlo; anotar cualquier problema encontrado para reportarlo antes de continuar con el import real.

No requiere conocimientos técnicos — cada punto describe qué hacer y qué se espera ver. **Esta lista NO se marca como completada automáticamente — el propietario debe volver a correrla él mismo antes de avanzar al siguiente paso del proyecto.**

## 0. Consola y advertencias técnicas (Fase 019.6)

Si tienes forma de ver la consola del navegador (F12 → pestaña "Console") o la terminal donde corre el servidor, revisa esto durante el resto de la prueba:

- [ ] Al entrar al Dashboard y navegar entre pantallas (Contactos, Tareas, Primas/Pagos, Comisiones, Pólizas), **no debe aparecer** el mensaje `Calling client.query() when the client is already executing a query` en la terminal del servidor.
- [ ] La consola del navegador no debe mostrar errores en rojo al usar el CRM normalmente (algunos avisos amarillos informativos de Next.js en desarrollo son normales).

## 1. Acceso

- [ ] **Login**: entrar con un usuario ADMIN válido. Un correo/contraseña incorrectos muestran "Correo o contraseña incorrectos" (sin decir cuál de los dos está mal).
- [ ] **Logout y vuelta a login**: cerrar sesión desde el menú de usuario y confirmar que ya no se puede ver ninguna página sin volver a iniciar sesión.

## 2. Usuarios (Configuración → Usuarios, solo ADMIN)

- [ ] Crear un usuario nuevo con rol **Agente**. Confirmar que aparece la contraseña temporal en pantalla — anotarla, porque no se vuelve a mostrar.
- [ ] Cerrar sesión y entrar con ese nuevo agente usando la contraseña temporal — debe funcionar.
- [ ] Crear un usuario con rol **Asistente**.
- [ ] Desactivar un usuario que no sea el único administrador — confirmar que desaparece de la lista de "Activos" y que si intenta iniciar sesión, no puede entrar.
- [ ] Intentar desactivar el único administrador activo (si solo hay uno) — debe mostrar un mensaje explicando que no se puede dejar el CRM sin administrador.

## 3. Contactos

- [ ] Crear un contacto nuevo (prospecto).
- [ ] Editar el contacto: agregar dirección — completar el bloque de dirección del **Hogar**, no de la persona (la dirección vive a nivel de hogar/familia, ver tab "Familia").
- [ ] Agregar el ingreso familiar estimado y el año en la sección de Hogar.
- [ ] Convertir el prospecto en cliente (cambiar su estado).
- [ ] Buscar el contacto por nombre, teléfono y correo desde el buscador — debe aparecer en los tres casos.

## 4. Hogar / Familia

- [ ] Desde el tab "Familia" del contacto, agregar un cónyuge y al menos un dependiente.
- [ ] Confirmar que el hogar muestra correctamente dirección, ciudad/estado/ZIP, condado e ingreso familiar en el resumen del contacto.
- [ ] **(Fase 019.6)** En el formulario de dirección/ingreso del hogar, cambiar el ingreso familiar (ej. de 200000 a 210000) y presionar Guardar. Debe aparecer el mensaje verde **"Datos del hogar guardados correctamente."** — antes de esta fase, el formulario no mostraba ningún cambio visible al guardar.
- [ ] Recargar la página completa del navegador (F5) y confirmar que el ingreso actualizado (210000) sigue ahí — la persistencia real, no solo lo que se ve en pantalla justo después de guardar.
- [ ] Mientras se guarda, el botón debe decir "Guardando…" brevemente y no debe poder presionarse dos veces seguidas.

## 5. Pólizas de Salud

- [ ] Crear una póliza de Salud para el contacto, marcando el tipo de cobertura como **Marketplace** — confirmar que aparece el campo de estado de Marketplace.
- [ ] Crear una segunda póliza de Salud marcada como **Privada** — confirmar que los campos específicos de Marketplace no aparecen o quedan vacíos.
- [ ] Intentar guardar una póliza con fecha de finalización **anterior** a la fecha de inicio — debe rechazarse con el mensaje "La fecha de finalización no puede ser anterior a la fecha de inicio." mostrado **justo debajo del campo "Fecha de terminación"** (en rojo, con el campo resaltado) — antes de esta fase, ese mensaje no aparecía en pantalla aunque el servidor sí lo generaba.
- [ ] Confirmar que, al ver ese error, el resto de los datos que ya habías llenado (compañía, producto, prima, etc.) siguen ahí — no se borran.
- [ ] Corregir la fecha de finalización (poniendo una posterior a la de inicio) y guardar de nuevo — debe guardar sin problema y llevarte al detalle de la póliza ya creada/actualizada.

## 6. Documentos de póliza

- [ ] Desde el detalle de una póliza, subir un PDF (ej. un resumen de plan) — debe aparecer en la lista de documentos y debe mostrarse el mensaje "Documento subido correctamente."
- [ ] Subir una imagen (PNG o JPG) — debe aparecer también, con el mismo mensaje de confirmación.
- [ ] Abrir/descargar un documento subido — debe abrir correctamente.
- [ ] Eliminar un documento — debe desaparecer de la lista.

## 7. Tareas

- [ ] Crear una tarea vinculada al contacto (ej. "Llamar para confirmar renovación") con fecha de mañana.
- [ ] Confirmar que aparece en "Tareas próximas", no en "Tareas de hoy" ni "vencidas".
- [ ] Marcarla como completada.

## 8. Notas

- [ ] Desde el tab "Notas" del contacto, agregar una nota operativa (ej. "Prefiere contacto por WhatsApp") — debe mostrar "Nota guardada correctamente." y vaciar el cuadro de texto.
- [ ] Confirmar que aparece en la lista, con fecha y autor, la más reciente primero.

## 9. Cumpleaños

- [ ] Ir a Cumpleaños y confirmar que se ve el cumpleaños del contacto de prueba (si tiene fecha de nacimiento registrada) en el mes correspondiente.
- [ ] Marcar una tarjeta como "Enviada", eligiendo un medio (WhatsApp/SMS/Email).

## 10. Primas y pagos

- [ ] Desde el detalle de la póliza, editar el seguimiento de pago: monto de prima, frecuencia, próxima fecha de pago.
- [ ] Marcar la póliza como "Requiere asistencia" y confirmar que aparece en `/premiums` filtrando por esa condición.
- [ ] Probar los filtros de `/premiums` **sin seleccionar nada** (dejar los selectores en su opción vacía) y confirmar que la página carga sin error — este era el bug reportado en la primera prueba.

## 11. Comisiones (solo ADMIN/Agente)

- [ ] En Configuración → Productos, abrir un producto y crear una regla de comisión (ej. monto fijo mensual, o porcentaje de la prima anualizada con residual desde el año 2) — debe mostrar "Regla de comisión guardada." y limpiar el formulario.
- [ ] Desde el detalle de una póliza de ese producto, usar "Generar expectativa" para un mes concreto — debe aparecer en la sección de Comisiones de la póliza.
- [ ] Repetir "Generar expectativa" para el mismo mes — debe indicar que ya existía, sin duplicar.
- [ ] Registrar un pago contra esa expectativa.
- [ ] Registrar un chargeback — confirmar que se resta del total recibido.
- [ ] Confirmar que un usuario Asistente **no** ve el tab "Comisiones" en el contacto ni el módulo de Comisiones en el menú.

## 12. Autorización por rol

- [ ] Iniciar sesión como **Agente**: confirmar que solo ve/edita sus propios contactos asignados (o sin asignar), y que no puede administrar usuarios ni compañías/productos.
- [ ] Iniciar sesión como **Asistente**: confirmar que no ve comisiones en ningún lado (menú, tab de contacto, detalle de póliza), pero sí puede gestionar documentos de póliza y primas/pagos.

## 13. Aspecto visual

- [ ] Revisar que el logo de TuPlanSeguro USA aparece correctamente en el login, la barra lateral y el menú móvil.
- [ ] Revisar que los colores (azul, verde, y el naranja usado con moderación) se ven consistentes en botones, pestañas activas y badges.
- [ ] Probar la aplicación en el celular (o achicando la ventana del navegador): el menú debe convertirse en un ícono de hamburguesa funcional, y las pantallas no deben verse cortadas ni requerir scroll horizontal.

## 14. Cierre

- [ ] Volver al Dashboard y confirmar que refleja los cambios hechos durante esta prueba (tareas, pagos, comisiones, cumpleaños).

## 15. Miembros de una póliza ya existente (Fase 019.7 — Hallazgo #12)

- [ ] Abrir el detalle de una póliza que ya tenga al menos un miembro del hogar SIN cubrir. En la sección "Miembros cubiertos", usar "+ Agregar miembro" y confirmar que solo aparecen las personas del hogar que **todavía no** están cubiertas por esa póliza.
- [ ] Agregar uno de esos miembros — debe aparecer de inmediato en la lista de cubiertos, sin recargar la página manualmente.
- [ ] Confirmar que agregar un miembro a la póliza **no** lo agrega automáticamente a ninguna otra póliza del mismo hogar (revisar otra póliza del mismo cliente y confirmar que esa persona sigue sin aparecer ahí).
- [ ] Ir al tab "Familia" del contacto y agregar una persona nueva (ej. un hijo recién nacido) al hogar. Volver al detalle de la póliza y confirmar que esa persona nueva aparece de inmediato como candidata elegible en "+ Agregar miembro" (sin haber hecho nada más).
- [ ] Usar "Quitar de la póliza" sobre un miembro cubierto — debe desaparecer de la lista de esa póliza, pero la persona debe seguir existiendo normalmente en el hogar y en el contacto (no se borra a la persona).

## 16. Filiación familiar vs. rol en la póliza (Fase 019.7 — Hallazgo #13)

- [ ] Al agregar un miembro a una póliza, confirmar que junto al nombre aparece su relación familiar real tomada del hogar (ej. "Hija", "Esposo/a") — nunca debe decir "Otro" si esa relación ya se conoce.
- [ ] Confirmar que el rol de cobertura de la póliza (Dependiente/Otro/etc.) se sugiere automáticamente según esa relación familiar, pero puede cambiarse manualmente si hace falta.
- [ ] En el listado de miembros cubiertos de la póliza, confirmar que se muestran **ambos** datos por separado, por ejemplo: "Camila Ibarra — Hija — Dependiente de la póliza" (nunca se debe mezclar o inventar uno a partir del otro).

## 17. Comisiones generadas automáticamente por regla (Fase 019.7 — Hallazgo #14)

- [ ] Crear (o confirmar que existe) una regla de comisión para un producto. Activar/crear una póliza de ese producto y confirmar que, sin usar "Generar expectativa" manualmente, ya aparece una expectativa de comisión para el mes actual en la póliza.
- [ ] En el detalle de esa expectativa, confirmar que se distinguen visualmente el monto **Calculado** (según la regla) y el monto **Esperado** (el que se usa en el resto del sistema) cuando aún no se ha corregido nada — deben coincidir.
- [ ] Editar manualmente el monto esperado de esa expectativa y guardar un motivo (ej. "Bono del carrier"). Confirmar que ahora se muestra un aviso indicando que el monto fue corregido manualmente, con quién lo hizo y cuándo.
- [ ] Agregar un cuarto miembro a una póliza con una regla "por miembro" y confirmar que el cambio afecta los períodos **futuros**, pero no modifica ni recalcula ningún mes anterior ya generado o pagado.
- [ ] Registrar un pago sobre una expectativa y luego intentar "recalcular"/volver a generar el mismo período — debe indicar que ya existe, sin tocar el monto ni el pago ya registrado.
- [ ] Confirmar que el Dashboard de Comisiones sigue mostrando montos coherentes con lo anterior (nunca debe mostrar un monto que no provenga de una expectativa/pago real).

## 18. Geografía asistida (Fase 019.7 — Hallazgo #15)

- [ ] En la dirección del hogar, confirmar que el campo **Estado** ahora es una lista desplegable con los 50 estados + DC + territorios (nunca texto libre) y que solo permite elegir un valor válido del catálogo.
- [ ] Confirmar que Ciudad, Condado y ZIP siguen siendo campos de texto por ahora (la búsqueda asistida de Ciudad/Condado/ZIP contra un catálogo público queda pendiente — ver `docs/DECISIONS.md` para el detalle de por qué se pospuso).

## 19. Formato de fechas en Estados Unidos (Fase 019.7 — hallazgo adicional)

- [ ] Revisar fechas visibles en Dashboard, Contactos, Hogar, Pólizas (fecha efectiva/terminación), Tareas, Cumpleaños, Primas, Comisiones, Notas y Usuarios — todas deben mostrarse como **MM/DD/AAAA** (ej. "09/01/2026"), nunca como "01/09/2026" ni con nombres de mes en español.
- [ ] Confirmar que los campos de fecha (fecha de nacimiento, fechas de póliza, fecha de tarea) muestran la pista "(MM/DD/AAAA)" junto a la etiqueta.
- [ ] Guardar una fecha (ej. fecha de nacimiento 03/15/1990) y recargar la página — debe seguir mostrando exactamente esa fecha, sin desplazarse un día por husos horarios.

## 20. Entrada de fecha con formato garantizado MM/DD/AAAA (Fase 019.8 — Hallazgo #16)

- [ ] En el formulario de un contacto nuevo, hacer clic en el campo "Fecha de nacimiento" e introducir `09011990` seguido — el campo debe insertar las barras automáticamente y mostrar `09/01/1990` (nunca `dd/mm/aaaa` del navegador).
- [ ] Guardar y confirmar que el resumen del contacto muestra `09/01/1990`. Recargar la página completa (F5) y confirmar que sigue mostrando la misma fecha.
- [ ] Repetir la prueba en Fecha efectiva/Fecha de terminación de una póliza y en la fecha de nacimiento al editar un contacto — mismo comportamiento en los tres casos.
- [ ] Intentar escribir una fecha imposible (ej. `13/10/2026` o `02/30/2026`) y guardar — debe rechazarse con un mensaje de error visible, nunca guardarse silenciosamente.

## 21. Póliza vinculada al Household en todos los flujos (Fase 019.8 — Hallazgo #17)

- [ ] Crear un contacto nuevo.
- [ ] Crear una póliza para ese contacto ANTES de armar su hogar (Flujo B).
- [ ] Ir al tab "Familia" del contacto, crear el hogar y agregar un cónyuge.
- [ ] Volver al detalle de la póliza — debe aparecer un aviso para "Vincular hogar" con el hogar recién creado.
- [ ] Hacer clic en "Vincular hogar".
- [ ] Usar "+ Agregar miembro" y confirmar que el cónyuge ya aparece como candidato elegible.
- [ ] Agregarlo y confirmar que se muestra como "Esposo/a" tanto en la filiación familiar como (por defecto) en el rol sugerido de la póliza.
- [ ] Usar "Quitar de la póliza" sobre ese miembro y confirmar que sigue apareciendo normalmente en el tab "Familia" del contacto (nunca se borra del hogar).

## 22. Medicamentos y proveedores/médicos preferidos (Fase 019.8 — Hallazgo #18)

- [ ] Abrir el tab "Salud" de un contacto (con o sin pólizas de Salud — las secciones de Medicamentos y Proveedores deben aparecer siempre).
- [ ] Usar "+ Agregar medicamento", ingresar solo el nombre (dejar dosis/frecuencia/notas vacíos) y guardar — debe guardarse sin exigir los campos opcionales.
- [ ] Editar ese medicamento agregando dosis y frecuencia — debe reflejarse de inmediato.
- [ ] Eliminarlo — debe desaparecer de la lista.
- [ ] Usar "+ Agregar proveedor", elegir un tipo (PCP/Especialista/Otro), completar nombre y teléfono, guardar.
- [ ] Editar ese proveedor y luego eliminarlo — debe desaparecer de la lista.
- [ ] Confirmar que un usuario con rol Agente sin acceso a ese contacto no puede ver ni editar sus medicamentos/proveedores.

## 23. Historial del cliente (Fase 019.9)

- [ ] Crear un contacto nuevo — ir a su pestaña "Historial" y confirmar que aparece "Contacto creado" con tu nombre y la fecha/hora.
- [ ] Cambiar la dirección del hogar (tab Familia) — volver a Historial y confirmar que aparece el evento, con "Ver cambios" mostrando la dirección anterior y la nueva.
- [ ] Cambiar el ingreso familiar — confirmar que aparece un evento separado con el valor anterior y el nuevo.
- [ ] Crear una póliza para ese contacto — confirmar que aparece "Póliza ... creada" tanto en el Historial del contacto como en el Historial de la propia póliza (Policy Detail).
- [ ] Agregar un miembro a esa póliza — confirmar el evento correspondiente, con el nombre de la persona en el resumen.
- [ ] Editar el seguimiento de pago (prima) de la póliza — confirmar que aparece un evento de "Seguimiento de pago actualizado".
- [ ] Cancelar la póliza (cambiar estado a Cancelada) — confirmar que aparece "Póliza cancelada" con tu usuario y la fecha exacta.
- [ ] Probar los filtros de categoría (Contacto/Familia/Pólizas/Salud/Tareas/Notas/Primas/Comisiones/Documentos) y confirmar que cada uno muestra solo los eventos correspondientes.

## 24. Auditoría — quién hizo cada cambio

- [ ] Iniciar sesión como ADMIN, hacer un cambio (ej. actualizar un contacto) y confirmar en su Historial que el evento muestra tu nombre real, no un texto genérico.
- [ ] Iniciar sesión como Agente (con acceso a un contacto propio), modificar ese contacto y confirmar que el Historial muestra el nombre del Agente, no el del ADMIN.
- [ ] Iniciar sesión como Asistente y abrir el Historial de un contacto con pólizas/comisiones — confirmar que **no aparece ningún evento de Comisiones** (regla de comisión, expectativa, pago), aunque sí aparezcan los demás eventos (pólizas, tareas, salud, etc.).

## 25. Renovación de póliza (Fase 019.9 — Hallazgo #3)

- [ ] Desde el detalle de una póliza, usar "Renovar póliza".
- [ ] Confirmar que el formulario ya trae precargado el producto/compañía de la póliza original, pero el número de póliza y las fechas están en blanco.
- [ ] Guardar — confirmar que te lleva a una póliza **nueva** (URL distinta).
- [ ] Volver a la póliza original y confirmar que sigue exactamente igual (mismo número, mismo estado, sin cambios).
- [ ] En el Historial de la póliza nueva, confirmar que aparece el evento de renovación.
- [ ] Intentar renovar la misma póliza original por segunda vez — debe rechazarse con un mensaje claro (ya tiene una renovación).

## 26. Buscador global (Fase 019.9 — Hallazgo #6)

- [ ] Usar la caja de búsqueda del encabezado (o ir a `/search`) y buscar por nombre de un contacto conocido — debe aparecer en "Contactos".
- [ ] Buscar por teléfono y por correo del mismo contacto — debe aparecer en ambos casos.
- [ ] Buscar por número de una póliza conocida — debe aparecer en "Pólizas".
- [ ] Como Agente, buscar el número de una póliza que NO está dentro de tu cartera — no debe aparecer en los resultados.

---

**Si algo de esta lista falla o se ve distinto a lo esperado, anótalo con la mayor cantidad de detalle posible (qué se hizo, qué se esperaba, qué pasó) antes de continuar con los siguientes pasos del proyecto** (creación de usuarios reales, resolución de bloqueos de importación, segundo dry run, autorización de `--apply`).
