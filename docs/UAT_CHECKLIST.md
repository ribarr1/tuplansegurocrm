# Checklist de prueba funcional manual (UAT) — Fase 019.5

Lista de pruebas para que el dueño de TuPlanSeguro USA verifique el CRM de punta a punta, con datos de prueba (nunca el Excel real todavía). Marcar cada punto al probarlo; anotar cualquier problema encontrado para reportarlo antes de continuar con el import real.

No requiere conocimientos técnicos — cada punto describe qué hacer y qué se espera ver.

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

## 5. Pólizas de Salud

- [ ] Crear una póliza de Salud para el contacto, marcando el tipo de cobertura como **Marketplace** — confirmar que aparece el campo de estado de Marketplace.
- [ ] Crear una segunda póliza de Salud marcada como **Privada** — confirmar que los campos específicos de Marketplace no aparecen o quedan vacíos.
- [ ] Intentar guardar una póliza con fecha de finalización **anterior** a la fecha de inicio — debe rechazarse con el mensaje "La fecha de finalización no puede ser anterior a la fecha de inicio."
- [ ] Guardar la misma póliza con la fecha de finalización correcta (igual o posterior a la fecha de inicio) — debe guardar sin problema.

## 6. Documentos de póliza

- [ ] Desde el detalle de una póliza, subir un PDF (ej. un resumen de plan) — debe aparecer en la lista de documentos.
- [ ] Subir una imagen (PNG o JPG) — debe aparecer también.
- [ ] Abrir/descargar un documento subido — debe abrir correctamente.
- [ ] Eliminar un documento — debe desaparecer de la lista.

## 7. Tareas

- [ ] Crear una tarea vinculada al contacto (ej. "Llamar para confirmar renovación") con fecha de mañana.
- [ ] Confirmar que aparece en "Tareas próximas", no en "Tareas de hoy" ni "vencidas".
- [ ] Marcarla como completada.

## 8. Notas

- [ ] Desde el tab "Notas" del contacto, agregar una nota operativa (ej. "Prefiere contacto por WhatsApp").
- [ ] Confirmar que aparece en la lista, con fecha y autor, la más reciente primero.

## 9. Cumpleaños

- [ ] Ir a Cumpleaños y confirmar que se ve el cumpleaños del contacto de prueba (si tiene fecha de nacimiento registrada) en el mes correspondiente.
- [ ] Marcar una tarjeta como "Enviada", eligiendo un medio (WhatsApp/SMS/Email).

## 10. Primas y pagos

- [ ] Desde el detalle de la póliza, editar el seguimiento de pago: monto de prima, frecuencia, próxima fecha de pago.
- [ ] Marcar la póliza como "Requiere asistencia" y confirmar que aparece en `/premiums` filtrando por esa condición.
- [ ] Probar los filtros de `/premiums` **sin seleccionar nada** (dejar los selectores en su opción vacía) y confirmar que la página carga sin error — este era el bug reportado en la primera prueba.

## 11. Comisiones (solo ADMIN/Agente)

- [ ] En Configuración → Productos, abrir un producto y crear una regla de comisión (ej. monto fijo mensual, o porcentaje de la prima anualizada con residual desde el año 2).
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

---

**Si algo de esta lista falla o se ve distinto a lo esperado, anótalo con la mayor cantidad de detalle posible (qué se hizo, qué se esperaba, qué pasó) antes de continuar con los siguientes pasos del proyecto** (creación de usuarios reales, resolución de bloqueos de importación, segundo dry run, autorización de `--apply`).
