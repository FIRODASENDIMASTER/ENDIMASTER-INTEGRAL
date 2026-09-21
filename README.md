# ENDIMASTER Backend

Backend real para el dashboard ENDIMASTER: conecta QuickBooks Online, calcula KPIs
reales y expone un proxy seguro para el copiloto de IA (la API key de Anthropic
nunca se expone al navegador).

## 1. Requisitos

- Node.js 18+ (usa `fetch` nativo)
- PostgreSQL 14+
- Una app creada en https://developer.intuit.com (gratis) con una *sandbox company*
- Una API key de Anthropic

## 2. Instalación

```bash
cd endimaster-backend
npm install
cp .env.example .env
```

Edita `.env` y llena:
- `DATABASE_URL` con tu conexión a Postgres
- `TOKEN_ENCRYPTION_KEY` (genera una con el comando que aparece en el archivo)
- `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` (de tu app en developer.intuit.com)
- `ANTHROPIC_API_KEY`
- `FRONTEND_URL` (la URL donde sirves `EndiMaster_conectado.html`, ej. `http://localhost:5500`)

## 3. Crear la base de datos

```bash
createdb endimaster
psql -d endimaster -f db/schema.sql
```

## 4. Levantar el servidor

```bash
npm run dev
```

Verifica que responda: `curl http://localhost:3000/health`

## 5. Crear tu primera empresa y conectar QuickBooks

```bash
curl -X POST http://localhost:3000/api/companies \
  -H "Content-Type: application/json" \
  -d '{"name":"Mi Empresa Piloto","sector":"Retail","currency":"USD"}'
```

Copia el `id` que te devuelve. Luego, en el navegador, visita:

```
http://localhost:3000/api/connectors/quickbooks/connect/<ID_DE_LA_EMPRESA>
```

Esto te lleva a Intuit para autorizar el acceso a la *sandbox company*. Al terminar,
te regresa automáticamente a `FRONTEND_URL` con los datos del primer mes ya
sincronizados en la base de datos.

## 6. Servir el frontend conectado

Abre `EndiMaster_conectado.html` con cualquier servidor estático (Live Server de
VS Code, `npx serve`, etc.) en el puerto que pusiste en `FRONTEND_URL`. El copiloto
ya no llama directo a Anthropic: llama a `http://localhost:3000/api/copilot/ask`.

Si quieres apuntar a otro backend (ej. en producción), define antes de cargar el
script principal:

```html
<script>window.ENDIMASTER_API_BASE = 'https://api.tudominio.com';</script>
```

## 7. Mantener los datos sincronizados

Para traer datos nuevos periódicamente sin esperar a que alguien abra el dashboard:

```bash
npm run sync:cron    # corre cada hora, en segundo plano (usar con pm2/systemd en producción)
npm run sync:once    # corre una sola vez, util para probar o para un cron externo
```

## 8. Autenticación y roles (ya incluida)

El backend ahora tiene login real con JWT y roles por empresa. Flujo resumido:

```bash
# Crear el primer usuario (quedará sin empresa todavía)
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"tu@correo.com","password":"unaClaveSegura123","fullName":"Tu Nombre"}'

# Guarda el "token" que te devuelve, y crea tu empresa (quedas como 'ceo' automaticamente)
curl -X POST http://localhost:3000/api/companies \
  -H "Content-Type: application/json" -H "Authorization: Bearer TU_TOKEN" \
  -d '{"name":"Mi Empresa","sector":"Retail","currency":"USD"}'

# Invitar a alguien mas (solo ceo/admin pueden hacerlo)
curl -X POST http://localhost:3000/api/companies/<ID_EMPRESA>/invite \
  -H "Content-Type: application/json" -H "Authorization: Bearer TU_TOKEN" \
  -d '{"email":"contador@empresa.com","role":"contador"}'
```

Roles disponibles: `ceo`, `admin`, `contador`, `finanzas`, `ventas`, `rrhh`, `operaciones`, `crm`.
Solo `ceo`/`admin`/`contador`/`finanzas` pueden ver `/financials` y `/anomalies`.
Solo `ceo`/`admin` pueden conectar sistemas externos (QuickBooks) e invitar usuarios.

`EndiMaster_conectado.html` ya incluye una pantalla de login que habla con estos
endpoints (`/api/auth/login`, `/api/auth/register`, `/api/auth/me`) y guarda el
token en `sessionStorage` para adjuntarlo en cada llamada al copiloto y a los
datos financieros.

**Nota de seguridad:** `sessionStorage` es aceptable para arrancar, pero para
producción real lo más seguro es que el backend emita una cookie `httpOnly` en
vez de un token accesible desde JavaScript (evita robo de token por XSS).

## 9. Siguientes pasos técnicos recomendados

1. Conectar el resto del frontend (`renderKpiFinancial`, `drawForecast`,
   `renderAnomalyList`) a `fetchRealFinancials()` en vez de a `computeSeries()`
   con datos simulados — ya llega autenticado, falta pintar los datos reales.
2. Mostrar/ocultar los ítems del menú lateral (`navitem`) según `req.companyRole`
   devuelto por `/api/auth/me`, para que ventas no vea Finanzas y viceversa.
3. Agregar un segundo conector (Contpaqi, Siigo o el sistema que usen tus primeros
   clientes piloto) siguiendo el mismo patrón de `quickbooksService.js`.
4. Mover `npm run sync:cron` a un proceso administrado (pm2, systemd, o un Job
   programado en tu proveedor de hosting).
5. Migrar el token de `sessionStorage` a una cookie `httpOnly` antes de salir a producción.

## Estructura del proyecto

```
endimaster-backend/
├── db/schema.sql              # Esquema real (reemplaza a generateDemoDataset)
├── src/
│   ├── index.js                # Servidor Express
│   ├── config/db.js            # Conexión a PostgreSQL
│   ├── routes/
│   │   ├── connectors.js       # OAuth de QuickBooks
│   │   ├── financials.js       # KPIs y empresas
│   │   └── copilot.js          # Proxy seguro para la IA
│   ├── services/
│   │   ├── quickbooksService.js
│   │   ├── kpiService.js       # Cálculo de EBITDA, márgenes, anomalías
│   │   └── cryptoService.js    # Cifrado de tokens OAuth
│   └── jobs/syncWorker.js      # Sincronización periódica
```
