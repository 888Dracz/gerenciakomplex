/**
 * tipos.ts — Modelo de datos de Gerencia Komplex.
 *
 * Lo comparten el servidor (que valida y guarda) y la interfaz (que calcula y
 * dibuja): por eso este archivo y el resto de `dominio/` no importan nada de
 * Node ni del navegador.
 *
 * Las monedas y sus reglas son las del Excel "Komplex Gym - Registro de pagos":
 *  - Dólares y Zelle no llevan tasa.
 *  - Bs: banco emisor, banco receptor y n° de referencia.
 *  - Zelle y Bancolombia: n° de confirmación.
 *  - Bs, Zelle y Bancolombia son transferencias: hay que verificar que llegaron.
 *  - Dólares y Cop son efectivo: entran a la caja y se cuentan en el cuadre.
 */

// ---------------------------------------------------------------- monedas
export const MONEDAS = ['Dólares', 'Zelle', 'Bs', 'Cop', 'Bancolombia'] as const;
export type Moneda = (typeof MONEDAS)[number];

export const MONEDAS_EFECTIVO = ['Dólares', 'Cop'] as const;
export type MonedaEfectivo = (typeof MONEDAS_EFECTIVO)[number];

export const MONEDAS_TRANSFERENCIA = ['Bs', 'Zelle', 'Bancolombia'] as const;
export type MonedaTransferencia = (typeof MONEDAS_TRANSFERENCIA)[number];

export interface InfoMoneda {
  /** Entra a la caja física (se cuenta en el cuadre). */
  efectivo: boolean;
  /** Pide tasa: unidades de esa moneda por cada dólar. */
  tasa: boolean;
  /** Comprobante que pide: banco emisor/receptor + referencia, o solo confirmación. */
  ref: 'banco' | 'confirmacion' | null;
  /** Tasa del día que se le propone (Bs o pesos). */
  tasaDe: 'Bs' | 'Cop' | null;
  /** Etiqueta corta de la cifra en su moneda. */
  unidad: string;
}

export const INFO_MONEDA: Record<Moneda, InfoMoneda> = {
  Dólares: { efectivo: true, tasa: false, ref: null, tasaDe: null, unidad: 'USD' },
  Zelle: { efectivo: false, tasa: false, ref: 'confirmacion', tasaDe: null, unidad: 'USD' },
  Bs: { efectivo: false, tasa: true, ref: 'banco', tasaDe: 'Bs', unidad: 'Bs' },
  Cop: { efectivo: true, tasa: true, ref: null, tasaDe: 'Cop', unidad: 'COP' },
  Bancolombia: { efectivo: false, tasa: true, ref: 'confirmacion', tasaDe: 'Cop', unidad: 'COP' },
};

export const esMoneda = (v: unknown): v is Moneda => (MONEDAS as readonly unknown[]).includes(v);
export const esEfectivo = (m: Moneda): m is MonedaEfectivo => INFO_MONEDA[m].efectivo;
export const esTransferencia = (m: Moneda): m is MonedaTransferencia => !INFO_MONEDA[m].efectivo;

// ---------------------------------------------------------------- registro
export const TIPOS_REGISTRO = ['Nuevo', 'Renovación', 'Pago mixto'] as const;
export type TipoRegistro = (typeof TIPOS_REGISTRO)[number];

export const ESTADOS_TRANSFERENCIA = ['pendiente', 'confirmada', 'no_llego'] as const;
export type EstadoTransferencia = (typeof ESTADOS_TRANSFERENCIA)[number];

export const ETIQUETA_ESTADO: Record<EstadoTransferencia, string> = {
  pendiente: 'Pendiente',
  confirmada: 'Llegó',
  no_llego: 'No llegó',
};

/** Una línea de cobro. Un registro puede tener varias (pago en varias monedas). */
export interface Pago {
  moneda: Moneda;
  monto: number;
  /** Unidades de la moneda por dólar. Siempre 1 en Dólares y Zelle. */
  tasa: number;
  bancoEmisor?: string;
  bancoReceptor?: string;
  /** Bs: n° de referencia. Zelle y Bancolombia: n° de confirmación. */
  referencia?: string;
  /** Solo transferencias: si el dinero llegó al banco. */
  estado?: EstadoTransferencia;
  verificadoPor?: string;
  verificadoEn?: string;
}

/** Cambio devuelto en efectivo: sale de la caja. */
export interface Vuelto {
  moneda: MonedaEfectivo;
  monto: number;
  tasa: number;
}

export interface Registro {
  id: string;
  /** 'AAAA-MM-DD' */
  fecha: string;
  afiliado: string;
  plan: string;
  /**
   * Nuevo y Renovación cuentan como afiliado. "Pago mixto" es dinero que
   * completa otro pago (por ejemplo, el resto que trajo al día siguiente):
   * suma al ingreso pero no cuenta dos veces como afiliado.
   */
  tipo: TipoRegistro;
  /** Convenio: 50% de descuento sobre el precio del plan. */
  convenio: boolean;
  /** Precio del plan en USD al momento de registrar (0 en Pago mixto). */
  precioPlan: number;
  pagos: Pago[];
  vueltos: Vuelto[];
  notas: string;
  creadoPor: string;
  creadoEn: string;
  editadoPor?: string;
  editadoEn?: string;
}

// ---------------------------------------------------------------- caja
export const TIPOS_MOVIMIENTO = ['gasto', 'ingreso', 'retiro'] as const;
export type TipoMovimiento = (typeof TIPOS_MOVIMIENTO)[number];

export const ETIQUETA_MOVIMIENTO: Record<TipoMovimiento, string> = {
  gasto: 'Gasto',
  ingreso: 'Otro ingreso',
  retiro: 'Retiro / entrega',
};

/**
 * Movimiento de caja que no es una afiliación:
 *  - gasto: lo que se paga con dinero del gimnasio (limpieza, agua, arreglos).
 *  - ingreso: otro cobro (venta de agua, toalla, casillero…).
 *  - retiro: dinero que sale de la caja hacia la gerencia o el banco. No es
 *    gasto: solo cambia de lugar.
 */
export interface Movimiento {
  id: string;
  fecha: string;
  tipo: TipoMovimiento;
  concepto: string;
  categoria: string;
  moneda: Moneda;
  monto: number;
  tasa: number;
  referencia?: string;
  notas: string;
  creadoPor: string;
  creadoEn: string;
  editadoPor?: string;
  editadoEn?: string;
}

export type Efectivo = Record<MonedaEfectivo, number>;

export const efectivoCero = (): Efectivo => ({ Dólares: 0, Cop: 0 });

/** Fondo de caja con el que abre el día. */
export interface Apertura {
  fecha: string;
  fondo: Efectivo;
  responsable: string;
  actualizadoEn: string;
}

/** Cierre de caja del día: lo contado frente a lo que el sistema espera. */
export interface Cuadre {
  fecha: string;
  contado: Efectivo;
  /** Copia de lo esperado al momento de cuadrar (para detectar cambios después). */
  esperado: Efectivo;
  diferencia: Efectivo;
  totalDiaUSD: number;
  transferencias: { total: number; confirmadas: number; pendientes: number; noLlegaron: number };
  responsable: string;
  observaciones: string;
  cerradoEn: string;
}

/** Tasa del día: Bs y pesos por dólar. */
export interface Tasas {
  Bs?: number;
  Cop?: number;
}

/** Todo lo que pasa en un mes. Se guarda en `datos/AAAA-MM.json`. */
export interface DatosMes {
  mes: string;
  registros: Registro[];
  movimientos: Movimiento[];
  aperturas: Apertura[];
  cuadres: Cuadre[];
  tasas: Record<string, Tasas>;
}

/** Datos de varios meses juntos (lo que pide la interfaz para un rango). */
export interface Datos {
  registros: Registro[];
  movimientos: Movimiento[];
  aperturas: Apertura[];
  cuadres: Cuadre[];
  tasas: Record<string, Tasas>;
}

export const datosVacios = (): Datos => ({ registros: [], movimientos: [], aperturas: [], cuadres: [], tasas: {} });

// ---------------------------------------------------------------- configuración
export interface Plan {
  nombre: string;
  /** Precio en USD. */
  precio: number;
  activo: boolean;
}

export interface Cierre {
  mes: string;
  cerradoEn: string;
  cerradoPor: string;
  /** Foto de las cifras del mes al cerrarlo. */
  resumen: {
    registros: number;
    afiliados: number;
    ingresoUSD: number;
    gastosUSD: number;
    transferenciasPendientes: number;
  };
}

export interface EntradaBitacora {
  fecha: string;
  usuario: string;
  accion: string;
  detalle: string;
}

export interface Configuracion {
  version: 1;
  negocio: string;
  planes: Plan[];
  bancos: string[];
  categoriasGasto: string[];
  cierres: Record<string, Cierre>;
  bitacora: EntradaBitacora[];
  /** Clave de acceso (scrypt). La guarda el servidor; nunca sale hacia la interfaz. */
  clave?: { salt: string; hash: string };
  creadoEn: string;
}

/** Lo que la interfaz ve de la configuración (sin la clave). */
export type ConfigPublica = Omit<Configuracion, 'clave' | 'bitacora'>;

export const PLANES_INICIALES: Plan[] = [
  { nombre: 'Ilimitado', precio: 50, activo: true },
  { nombre: 'Tarde', precio: 40, activo: true },
  { nombre: 'Diurno', precio: 40, activo: true },
  { nombre: 'Turista', precio: 25, activo: true },
  { nombre: 'Día de entrenamiento', precio: 5, activo: true },
];

export const BANCOS_INICIALES = [
  'Banco de Venezuela', 'Banesco', 'Mercantil', 'Provincial (BBVA)', 'BNC (Nacional de Crédito)',
  'Bancamiga', 'Banco del Tesoro', 'Bicentenario', 'Bancaribe', 'Banco Exterior', 'Banco Plaza',
  'BFC (Fondo Común)', 'Banplus', 'Sofitasa', 'Banco Activo', '100% Banco', 'Banco Caroní',
  'Venezolano de Crédito', 'Del Sur', 'Banco Agrícola', 'Banfanb', 'R4',
];

export const CATEGORIAS_INICIALES = ['Limpieza', 'Mantenimiento', 'Servicios', 'Insumos', 'Personal', 'Otros'];

export function configInicial(ahora: string): Configuracion {
  return {
    version: 1,
    negocio: 'Komplex Gym',
    planes: PLANES_INICIALES.map((p) => ({ ...p })),
    bancos: [...BANCOS_INICIALES],
    categoriasGasto: [...CATEGORIAS_INICIALES],
    cierres: {},
    bitacora: [],
    creadoEn: ahora,
  };
}

/** Horas que dura el modo gerencial. */
export const GERENCIAL_HORAS = 24;
