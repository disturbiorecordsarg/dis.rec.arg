# Cómo conectar la web con la app de gestión (backend real)

Con esto queda armado: alguien compra una entrada en la web → el registro
aparece al instante en la app de gestión, en el evento correspondiente →
la cuenta maestra aprieta "Generar y enviar QR" → se manda un mail real
con los QR adjuntos → el staff de puerta escanea y queda marcado en tiempo real.

## 1. Crear el proyecto en Supabase

1. Andá a [supabase.com](https://supabase.com), creá una cuenta gratis y un
   proyecto nuevo (elegí una región cercana, ej. São Paulo).
2. Guardá la contraseña de la base que te pide al crear el proyecto.
3. Andá a **Project Settings → API** y copiá:
   - **Project URL**
   - **anon public key**

## 2. Cargar el esquema de la base de datos

1. En el panel de Supabase, andá a **SQL Editor → New query**.
2. Pegá todo el contenido del archivo `supabase-schema.sql` y ejecutalo (▶ Run).
   Esto crea las tablas (`eventos`, `entradas`, `tickets`, `staff_roles`), el
   bucket de storage `comprobantes` y todos los permisos (RLS).

## 3. Cargar tus eventos

En **Table Editor → eventos**, insertá una fila por cada evento, por ejemplo:

| nombre | fecha | lugar | activo |
|---|---|---|---|
| Disturbios en la Noche — Vol. VI | 10 y 11 de Sept | Groove, CABA | true |

Copiá el `id` (uuid) que se generó para el evento Vol. VI — lo vas a necesitar
en el paso 5.

## 4. Crear los usuarios de staff y la cuenta maestra

1. En **Authentication → Users → Add user**, creá:
   - La cuenta maestra: `disturbiorecordsarg@gmail.com` + una contraseña segura.
   - Una cuenta por cada persona de puerta (Lucas, Mateo, Valentino, Tomás, Juan Manuel...).
2. Por cada usuario creado, copiá su **User UID**.
3. En **Table Editor → staff_roles**, insertá una fila por usuario:

| user_id | nombre | rol |
|---|---|---|
| (uid de disturbiorecordsarg@gmail.com) | Disturbio Records Argentina | maestro |
| (uid de Lucas) | Lucas Fredes | puerta |
| (uid de Mateo) | Mateo Maureira | puerta |
| ... | ... | puerta |

## 5. Completar la configuración en los dos archivos HTML

En **`index.html`** (la web pública), buscá este bloque cerca del `<head>` y completalo:

```js
const SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
const SUPABASE_ANON_KEY = 'TU-ANON-KEY';
const EVENTO_VOL6_ID = 'PEGAR-AQUI-EL-ID-DEL-EVENTO-VOL6';
```

En **`app-gestion.html`** (la app de gestión), buscá el bloque equivalente
al principio del `<script>` y completá `SUPABASE_URL` y `SUPABASE_ANON_KEY`
con los mismos valores.

> Cada vez que crees un evento nuevo con su propio formulario de venta en la
> web, vas a necesitar repetir esta sección de "Adquirí tus entradas" con un
> `EVENTO_ID` distinto (o armar un selector si hay varios eventos a la vez).

## 6. Configurar el envío de mails reales (Resend)

1. Creá una cuenta gratis en [resend.com](https://resend.com) (plan free:
   3.000 mails/mes, de sobra para esto).
2. Si tenés un dominio propio, verificalo en Resend para poder mandar desde
   `entradas@tudominio.com`. Si no, podés usar el remitente de pruebas de
   Resend mientras arrancás.
3. Generá una **API Key** en Resend y guardala.

## 7. Deployar la Edge Function que genera y envía el QR

Necesitás tener instalado el [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
supabase login
supabase link --project-ref TU-PROJECT-REF   # está en Project Settings > General
supabase functions deploy enviar-qr
```

Después, en **Project Settings → Edge Functions → Secrets**, agregá:

```
RESEND_API_KEY = re_xxxxxxxxxxxx
MAIL_FROM = Disturbio Records <entradas@tudominio.com>
```

(`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya vienen seteadas
automáticamente por Supabase, no hace falta agregarlas.)

## 8. Publicar los dos HTML

Subí `index.html` y `app-gestion.html` a donde vayas a alojar el sitio
(GitHub Pages, Netlify, Vercel, hosting tradicional, etc. — cualquiera sirve,
porque ya no dependen de un backend propio, solo de Supabase).

## Cómo queda funcionando

1. Alguien completa el formulario de "Adquirí tus entradas" en la web →
   se sube el comprobante a Supabase Storage y se inserta un registro en
   `entradas` (estado `pendiente`), asociado al evento.
2. La cuenta maestra entra a la app de gestión → solapa **Entradas
   recibidas por mail** → ve la entrada al instante (ya no hace falta
   revisar el mail de Gmail a mano).
3. Aprieta **"Ver comprobante"** para chequear la transferencia, y
   **"Generar y enviar QR"** cuando está todo OK.
4. Eso dispara la Edge Function, que genera un código QR por cada
   asistente, arma el mail y lo manda de verdad al comprador con los QR
   adjuntos. La entrada pasa a estado `enviado`.
5. En la puerta, cada persona de staff escanea con su cuenta: la app
   marca el ticket como escaneado en la base al instante, y la cuenta
   maestra ve en tiempo real (solapa **Ver listado**) quién ya entró.

## Notas

- El link para "Ver comprobante" es temporal (60 segundos) por seguridad —
  se regenera cada vez que se aprieta el botón.
- Si en algún momento querés agregar más staff de puerta, solo hace falta
  crearlo en **Authentication → Users** y agregar su fila en `staff_roles`
  con `rol = 'puerta'`.
- Todo el volumen que manejan (unas pocas decenas/cientos de entradas por
  evento) entra cómodo en los planes gratuitos de Supabase y Resend.
