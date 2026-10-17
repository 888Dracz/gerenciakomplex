# Gerencia Komplex (Node + React)

Programa de gestión del **Komplex Gym**: caja, registro de pagos, verificación de
transferencias, cuadre de caja, resumen, informe para Gerencia (Word), Excel
con todos los datos y cierre de mes.

Está hecho como **Dorado Club**: servidor **Node 22 + Fastify** e interfaz
**React 19 + Vite**, todo en **TypeScript**, con el mismo estilo visual (con
el rojo de Komplex como acento). Las reglas de los pagos son las del Excel
*Komplex Gym - Registro de pagos*.

## Cómo se instala y se abre

1. Descarga el repositorio (botón verde **Code → Download ZIP**) y descomprímelo
   donde quieras, por ejemplo en `Documentos\GerenciaKomplex`.
2. La primera vez: doble clic en **`Instalar requisitos.bat`**.
   Instala Node.js si falta, descarga las librerías, compila y deja el icono
   **Gerencia Komplex** en el Escritorio.
3. Después, siempre: doble clic en el icono **Gerencia Komplex** del Escritorio
   (o en **`Iniciar Gerencia Komplex.bat`**). El programa se abre en **su propia
   ventana**, como cualquier programa. La ventana negra del servidor arranca
   minimizada: **al cerrarla se cierra el programa**.

Si ya estaba abierto y se vuelve a hacer doble clic, no arranca otro: solo
abre otra ventana del mismo.

## La primera vez: la carpeta de datos

Al entrar por primera vez el programa pide **crear la carpeta donde se guardará
la información** (por defecto `Documentos\Komplex Gerencia`; el botón
*Elegir…* abre el selector de carpetas de Windows) y una **clave de acceso**.

Desde ese momento todo lo que se registra se guarda **automáticamente** en esa
carpeta, que está **separada del programa**: si la carpeta del programa (o el
repositorio) se borra o se pierde, la información sigue en la computadora.

```
Komplex Gerencia\
  LEEME.txt
  datos\configuracion.json   planes, bancos, cierres de mes, bitácora
  datos\2026-10.json         registros, caja, cuadres y tasas de cada mes
  respaldos\2026-10-17.json  copia completa de cada día (se guardan 60)
  cierres\2026-09 Septiembre\  Excel, informe de Word y datos del mes cerrado
```

- Cada cambio se escribe en el acto (no hay botón "Guardar"). La escritura es
  atómica: si se va la luz, queda el archivo anterior entero, nunca uno a medias.
- La dirección de la carpeta se anota en `AppData\Local\GerenciaKomplex`. Si se
  reinstala el programa, la encuentra solo. Si se cambia de PC, se copia la
  carpeta completa y, al entrar, se elige esa carpeta: el programa reconoce
  que ya tiene datos y los usa.
- Se puede cambiar o mover la carpeta en *Configuración → Carpeta y respaldos*.
- Si la carpeta está dentro de OneDrive o Google Drive, además queda respaldada
  en la nube (los archivos son JSON con escritura atómica, sin el problema que
  tiene SQLite con OneDrive).

## Apartados

| Apartado | Qué hace |
| --- | --- |
| **Caja** | Cobrar afiliaciones (plan, tipo, convenio 50%, pago en una o varias monedas, vuelto), tasa del día, fondo de caja y gastos / otros ingresos / retiros. |
| **Registro** | Todos los pagos, con filtros, edición y borrado (la hoja *Registro* del Excel). |
| **Transferencias** | Pagos por Bs, Zelle y Bancolombia: botones **Llegó / No llegó** por día o todas las pendientes, con totales por moneda. |
| **Cuadre de caja** | Lo que debe haber en efectivo (fondo + cobros − vueltos + otros ingresos − gastos − retiros) frente a lo contado, en dólares y pesos; contador de billetes; cierre de caja del día. |
| **Resumen** | Ingreso, afiliados, nuevos, renovaciones, ingresos por moneda, planes, transferencias, gastos y cuadres de cualquier período. |
| **Cierre de mes** | Meses cerrados y abiertos, código gerencial. |
| **Configuración** | Planes y precios, bancos, categorías de gasto, carpeta, respaldos, clave, celular, apariencia y bitácora. |

Arriba siempre están **Excel** (descarga un Excel con *todos* los datos) e
**Informe** (Word para Gerencia del período que se elija).

### Reglas de los pagos (las del Excel)

- Monedas: **Dólares**, **Zelle**, **Bs**, **Cop**, **Bancolombia**.
- Dólares y Zelle no llevan tasa; Bs, Cop y Bancolombia sí (unidades por dólar).
  Total USD = monto / tasa.
- **Bs**: banco emisor, banco receptor y n° de referencia.
  **Zelle** y **Bancolombia**: n° de confirmación.
- Bs, Zelle y Bancolombia son **transferencias** y hay que verificarlas.
  Dólares y Cop son **efectivo** y se cuentan en el cuadre.
- **Total afiliados = Nuevo + Renovación.** Si alguien paga con dos monedas se
  agregan dos líneas en el mismo registro (en el Excel exportado la segunda sale
  como *Pago mixto*, igual que antes). El tipo *Pago mixto* también sirve para
  dinero que completa un pago anterior: suma al ingreso pero no cuenta como otro
  afiliado.
- El precio del plan se fija al registrar (50% con convenio): si luego cambia la
  lista de precios, el historial no se mueve.
- Una transferencia marcada **No llegó** no cuenta como ingreso.

## Cierre de mes y código gerencial

- Al **empezar a registrar en un mes nuevo** (desde el día 1), si el mes anterior
  tiene datos y sigue abierto, aparece una pregunta **obligatoria**:
  *«¿Quieres cerrar el registro del mes de Septiembre 2026?»*
  - **Sí** → el mes queda cerrado: no se puede crear, modificar ni borrar nada de
    él. Su Excel y su informe de Word se guardan solos en `cierres\`.
  - **No** → no se pueden hacer registros del mes nuevo hasta cerrarlo.
- **Código gerencial**: abre durante **24 horas**, en ese dispositivo, el modo
  gerencial: sin bloqueos ni avisos de cierre, se puede modificar cualquier mes
  (y reabrir uno cerrado). Todo lo que se cambia queda en la bitácora.
- Estas reglas las aplica el **servidor** en cada guardado, no solo la pantalla.

## Usar desde el celular

1. La primera vez, en la PC, ejecuta **`Permitir en la red.bat`** como
   administrador (abre el puerto 3004 en el Firewall de Windows).
2. Con el celular en el **mismo WiFi**, abre la dirección que aparece en
   *Configuración → Acceso y celular* (por ejemplo `http://192.168.1.20:3004`)
   y entra con tu nombre y la clave de acceso.
3. En el navegador del celular: **Agregar a pantalla de inicio** para tenerlo
   como una app.

La PC con el programa abierto es la que guarda los datos: el celular y la PC
ven y modifican la misma información.

## Cómo está organizado el código

```
gerenciakomplex/
├─ Instalar requisitos.bat · Iniciar Gerencia Komplex.bat · Permitir en la red.bat
├─ scripts/                 Icono del Escritorio y arranque en desarrollo
├─ server/                  Servidor (TypeScript → server/dist)
│  └─ src/
│     ├─ dominio/           Reglas del negocio (las usa también la interfaz)
│     │  ├─ tipos.ts        Monedas, registro, caja, cuadre, configuración
│     │  ├─ calculos.ts     Total USD, caja esperada, cuadre, resumen
│     │  ├─ periodos.ts     Cierre de mes
│     │  ├─ validar.ts      Validación de lo que llega de los formularios
│     │  └─ informe/        Informe para Gerencia (documento abstracto → Word)
│     ├─ almacen/           Carpeta de datos, JSON por mes, respaldos
│     ├─ rutas/             API REST (inicio, datos, administración)
│     ├─ sesiones.ts        Clave de acceso, sesiones y código gerencial
│     └─ index.ts           Arranque y ventana del programa
└─ web/                     Interfaz (React + TypeScript → server/public)
   └─ src/
      ├─ panels/            Caja, Registro, Transferencias, Cuadre, Resumen, Cierres, Configuración
      ├─ components/        Formulario de cobro, cierre de mes, informe…
      └─ lib/               Excel y Word sin dependencias (de Dorado Club), API, formatos
```

## Comandos (desarrollo)

```bash
npm run setup      # instala librerías y compila todo
npm run dev        # servidor + interfaz con recarga automática (http://localhost:5175)
npm run build      # compila servidor e interfaz
npm start          # arranca la versión compilada (puerto 3004)
npm test           # pruebas (cálculos, cierre de mes, API de punta a punta)
npm run typecheck  # revisa los tipos
```

Variables de entorno opcionales: `PORT` (3004), `HOST`, `KOMPLEX_DATA_DIR`
(fuerza la carpeta de datos), `KOMPLEX_APP_DIR` (dónde se anota la carpeta),
`KOMPLEX_NO_BROWSER=1` (no abrir ventana), `KOMPLEX_VENTANA=0` (abrir en una
pestaña normal del navegador en vez de una ventana propia).
