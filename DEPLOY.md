# Desplegar ENDIMASTER a un servidor real (accesible desde internet)

Esto saca el sistema de tu laptop y lo pone en un servidor de verdad, con un
dominio HTTPS, para que cualquier cliente pueda conectarse desde su propia
computadora. Usamos Render.com porque tiene plan gratis para el backend y la
base de datos, y no requiere tarjeta de credito para empezar.

## Antes de empezar

Vas a necesitar:
- Una cuenta de GitHub (gratis) — es donde vive tu codigo para que Render lo despliegue.
- GitHub Desktop (https://desktop.github.com) — para subir tu codigo sin usar comandos de git.
- Una cuenta de Render (gratis) — https://render.com

## Parte 1: Subir el codigo a GitHub

1. Instala GitHub Desktop y crea una cuenta de GitHub si no tienes.
2. Abre GitHub Desktop → File → New Repository. Nombralo "endimaster", elige
   la carpeta donde tienes TODO el proyecto (la que contiene `backend/`,
   `frontend/`, `render.yaml`).
3. Click "Create Repository", luego "Publish repository" (arriba). Puedes
   dejarlo como privado.

## Parte 2: Desplegar el backend + base de datos en Render

1. Entra a https://dashboard.render.com y crea tu cuenta (puedes usar tu cuenta de GitHub para entrar).
2. Click "New +" → "Blueprint".
3. Conecta tu repositorio de GitHub "endimaster". Render va a detectar el
   archivo `render.yaml` automaticamente y te va a mostrar 3 recursos:
   `endimaster-db` (base de datos), `endimaster-backend` (el servidor web),
   y `endimaster-sync` (un Cron Job que sincroniza QuickBooks/Siigo cada hora
   automaticamente, incluso si el servidor web esta "dormido").
4. Antes de confirmar, Render te va a pedir llenar las variables marcadas
   como "sync: false" (viven en el grupo compartido "endimaster-secrets",
   asi que las llenas UNA vez y las usan ambos servicios):
   - `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET`: los mismos de tu app en developer.intuit.com
   - `SIIGO_PARTNER_ID`: el que te asigno Siigo (si ya lo tienes)
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`: los de Google Cloud Console
   - Y en el servicio `endimaster-backend` especificamente (no en el grupo compartido):
     `QBO_REDIRECT_URI`, `GOOGLE_REDIRECT_URI`, `ANTHROPIC_API_KEY`, `FRONTEND_URL`
     (déjalos en blanco por ahora si aun no tienes las URLs de produccion, los completas en el paso 7)
5. Click "Apply". Render va a crear la base de datos, instalar las
   dependencias, y arrancar los 3 recursos. Tarda unos minutos.
6. Cuando termine, Render te da una URL publica como:
   `https://endimaster-backend.onrender.com`
   Esa es tu direccion real de backend. Guárdala.
7. Ve a "Environment" en el servicio `endimaster-backend` y actualiza:
   - `QBO_REDIRECT_URI` = `https://endimaster-backend.onrender.com/api/connectors/quickbooks/callback`
   - `GOOGLE_REDIRECT_URI` = `https://endimaster-backend.onrender.com/api/connectors/googlesheets/callback`
   Guarda — esto reinicia el servicio automaticamente.
8. Ve a tu app en developer.intuit.com → Settings → Redirect URIs, y agrega
   esa misma URL nueva (la de produccion, ademas de la de localhost que ya
   tenias — puedes tener varias). Repite lo mismo en Google Cloud Console
   para el redirect URI de Google Sheets.
9. Verifica que el Cron Job este corriendo: en el dashboard de Render, entra
   a `endimaster-sync` → pestaña "Logs". Deberia mostrar una ejecucion cada
   hora en punto, con lineas como `[sync] Empresa X actualizada`. Si sale
   vacio la primera hora, es normal — espera a la siguiente marca en punto.

## Parte 3: Desplegar el frontend (el HTML)

La forma mas simple: Netlify Drop (no requiere cuenta para probar).

1. Ve a https://app.netlify.com/drop
2. Antes de arrastrar el archivo, ábrelo con el Bloc de notas y agrega esta
   linea justo despues de `<body>` (al principio del archivo):
   ```html
   <script>window.ENDIMASTER_API_BASE = 'https://endimaster-backend.onrender.com';</script>
   ```
   (usa la URL real que te dio Render en el paso 6 de la Parte 2)
3. Arrastra el archivo `EndiMaster_conectado.html` a la pagina de Netlify Drop.
4. Netlify te da una URL como `https://nombre-al-azar.netlify.app`. Esa es tu
   direccion publica del dashboard.

## Parte 4: Conectar las dos puntas

1. Vuelve a Render → `endimaster-backend` → Environment → `FRONTEND_URL` =
   la URL que te dio Netlify (ej `https://nombre-al-azar.netlify.app`, SIN
   diagonal al final). Guarda.
2. Espera a que el backend reinicie (1-2 minutos).
3. Abre la URL de Netlify en tu navegador. Deberias ver la pantalla de login
   de ENDIMASTER, ahora sirviendo desde internet, no desde tu laptop.

## Importante: sigues en modo "Development" de QuickBooks

Desplegar a un servidor real NO te da automaticamente acceso a las QuickBooks
reales de tus clientes — eso requiere que Intuit apruebe tu app para
"Production" (ver conversacion anterior). Mientras tanto, este servidor real
sirve para: que tu y tu equipo prueben el sistema desde cualquier lugar, y
para que clientes piloto se registren y exploren el dashboard con datos de
demostracion mientras tramitas el acceso de produccion.

## Limitaciones del plan gratis de Render (a tener en cuenta)

- El backend "duerme" tras 15 minutos sin trafico, y tarda ~30 segundos en
  despertar en la siguiente visita (esto ya NO afecta la sincronizacion
  automatica -- el Cron Job de Render corre por separado y no depende de que
  el backend este despierto). Para un piloto esta bien que el backend duerma;
  para produccion real con clientes pagando, vale la pena subir al plan
  pagado (~$7/mes) para que la primera visita del dia no tarde esos 30 segundos.
- La base de datos gratis de Render expira a los 90 dias. Antes de eso,
  hay que migrarla a un plan pagado o hacer un respaldo.
- El Cron Job en plan gratis tambien puede tardar unos segundos extra en
  arrancar cada hora (arranca desde cero en cada ejecucion, corre, y se
  apaga) -- es el comportamiento esperado y normal para este tipo de servicio.
