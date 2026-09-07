# WhatsApp Cloud API — HIDACA

The native module uses Meta's official WhatsApp Cloud API. OpenWA is not part
of the runtime or deployment.

## Server-only variables

Configure these as Site/Worker secrets or variables; never put them in D1, R2,
client code, logs, `.env` committed files, or screenshots:

```text
WHATSAPP_ENABLED=false
WHATSAPP_CAMPAIGNS_ENABLED=false
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_WABA_ID=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_GRAPH_API_VERSION=v23.0
```

The production webhook URL is `/api/whatsapp/webhook`. `GET` validates
Meta's verify token and `POST` validates `X-Hub-Signature-256` over the raw body.
Every protected dashboard/API route still requires ChatGPT authentication and
the HIDACA allowlist; only this signature-verified webhook is anonymous.

## Ya implementado en HIDACA

- Espacio WhatsApp con Bandeja, Plantillas, Campañas y Administración.
- Conversaciones, mensajes, estados, asignaciones, vínculos CRM, permisos y auditoría.
- Webhook idempotente, matching Contactos/Prospectos, consentimiento, campañas resumibles y almacenamiento privado de medios.
- Estado de conexión seguro: `UNCONFIGURED`, `PARTIALLY_CONFIGURED`, `CONNECTED`, `ERROR` o `DISABLED`.

## Requiere una cuenta Meta

- Meta Business Portfolio verificado, una aplicación de Meta Developers y una cuenta WABA.
- Un número empresarial HIDACA conectado a la WABA y suscripción del webhook.
- Nombre visible y configuración comercial que HIDACA desee usar en producción.

## Requiere secretos de producción

Los valores de la tabla anterior deben agregarse como variables/secrets server-side
del Site. No se editan desde el navegador ni se guardan en D1/R2.

## Requiere aprobación de Meta y de HIDACA

- Plantillas de mensaje aprobadas por Meta, con su copy, idioma y categoría definitivos.
- Proceso de consentimiento operativo de HIDACA para Contactos y Prospectos.
- Aprobación explícita de HIDACA antes de habilitar campañas o cambiar el acceso público del Site.

## Onboarding and rollout

1. Create/verify the Meta Business app and connect one HIDACA business number.
2. Create a permanent system-user token with the WhatsApp permissions required
   by the Cloud API, subscribe the WABA webhook, and submit production templates.
3. Deploy schema and code with both flags disabled.
4. Add secrets and test-number configuration, then validate inbound/outbound
   text, image, document, audio, video, templates, assignments, CRM links, and
   status webhooks.
5. Obtain explicit approval, change Site edge access to public, and verify all
   non-webhook routes remain `401` without ChatGPT authentication.
6. Enable campaigns for a small opted-in audience, then activate production.

Campaign dispatch is immediate and template-only. The screen requests bounded
D1-backed batches while open; pausing or closing it does not delete progress.
Network timeouts are not retried automatically because Meta may have accepted
the message; explicit Meta failures remain eligible for a manual retry.

## Rollback

Disable both feature flags. If necessary unsubscribe the Meta webhook and
redeploy the previous Site version. The additive D1 schema, media objects, and
audit/event records remain intact.
