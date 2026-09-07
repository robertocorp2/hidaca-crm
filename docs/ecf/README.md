# HIDACA e-CF: implementación inicial

Esta capa extiende la factura operativa existente. No reemplaza facturas ni modifica registros importados.

## Estado implementado

- Migración aditiva `0016_little_terrax.sql` para perfiles fiscales, secuencias, snapshots, artefactos, validaciones, intentos e historial.
- Prevalidación y generación idempotente para E31, E32, E33 y E34 en el ambiente `test`.
- Configuración administrativa de perfiles y rangos, incluida habilitación explícita del perfil antes de asignar secuencias.
- Botón `Generar factura DGII` en el detalle de factura para usuarios con `ecf_generate`.
- XML estructural y hash SHA-256 almacenados en R2 cuando el binding `FILES` está disponible.
- Descarga privada de artefactos mediante `ecf_xml`, sin exponer las claves R2.
- Separación de permisos para generar, firmar, enviar, reintentar, ajustar, cancelar, descargar XML, consultar logs y configurar.
- Producción bloqueada por defecto mediante `ECF_PRODUCTION_ENABLED=false`.

## Bloqueos intencionales

La firma, la validación XSD oficial y la transmisión DGII devuelven un error accionable hasta que se configuren certificados, esquemas versionados y los servicios del ambiente correspondiente. Un XML generado localmente no se presenta como aceptado ni fiscalmente válido.

### Evidencia y límites de esta tranche

La aplicación ya conserva el documento comercial, la prevalidación, el snapshot
fiscal inmutable, la asignación idempotente de e-NCF, los artefactos y los
permisos separados. En este repositorio no se han inventado certificados,
credenciales, endpoints ni respuestas DGII. El manifiesto `xsd-manifest.json`
registra las fuentes oficiales y permanece en estado `to-vendor` hasta que un
responsable descargue, verifique el hash y apruebe los XSD vigentes.

Por tanto, la generación local es útil para revisión y pruebas de contrato,
pero no habilita firma, envío, TrackID, contingencia ni producción. Esos pasos
requieren certificado PKCS#12, secretos de ambiente, URLs oficiales por
ambiente, reglas DGII confirmadas y la certificación/autorización del emisor.
El bloqueo se aplica también server-side aunque se invoquen los endpoints
directamente.

## Configuración mínima de prueba

1. Habilitar `ECF_ENABLED=true`.
2. Crear un perfil `test` desde `/api/ecf/config` con RNC, razón social y dirección fiscal verificados.
3. Crear un rango por tipo con el mismo endpoint administrativo.
4. Confirmar el binding R2 `FILES`.
5. Ejecutar la revisión DGII y cargar los XSD oficiales fijados en `xsd-manifest.json`.

Las credenciales, certificados, claves maestras y tokens no se guardan en el repositorio.

## Datos heredados

Las facturas incompletas continúan disponibles y editables según sus permisos. Sólo una factura con datos fiscales suficientes puede generar un snapshot e-CF. Después de firmar o enviar, las correcciones deben usar el flujo E33/E34 correspondiente.

## Próxima tranche obligatoria

- Validación real con XSD E31/E32/E33/E34, RFCE, ARECF, ACECF y ANECF.
- Firma XMLDSig con certificado PKCS#12 en servidor.
- Worker fiscal público separado para recepción y aprobación comercial.
- Envío, consulta TrackID, representación impresa, contingencia y pruebas de certificación.
