/**
 * FormRegistro.tsx — Cobrar una afiliación (o editarla).
 *
 * Es el mismo formulario en la Caja y en el Registro. Sigue las reglas del
 * Excel: el precio sale del plan (50% con convenio), Dólares y Zelle no llevan
 * tasa, Bs pide banco emisor, banco receptor y referencia, Zelle y Bancolombia
 * el n° de confirmación. Si paga con varias monedas se agregan líneas en el
 * mismo registro (no hace falta otra fila de "Pago mixto").
 */
import { useEffect, useMemo, useState } from 'react';

import { enUSD, precioConConvenio, r2, tasaSugerida } from '@dominio/calculos';
import { mesDe } from '@dominio/fechas';
import { bloqueoEdicion } from '@dominio/periodos';
import {
  INFO_MONEDA, MONEDAS, TIPOS_REGISTRO, esEfectivo,
  type Moneda, type MonedaEfectivo, type Registro, type Tasas, type TipoRegistro,
} from '@dominio/tipos';
import { apiPost, apiPut, mensajeError } from '../lib/api';
import { fmtMonto, fmtNum, fmtUSD, hoyISO, leerNumero } from '../lib/format';
import { Ico } from '../lib/icons';
import { useAfiliados, useApp, useEstado, usePeriodos } from '../state/app';
import { useUI } from '../state/ui';
import { Autocomplete } from './Autocomplete';
import { Segmentado } from './basicos';
import { Candado, useCierre, useGuardiaCierre } from './Cierre';

interface Linea {
  moneda: Moneda | '';
  monto: string;
  tasa: string;
  bancoEmisor: string;
  bancoReceptor: string;
  referencia: string;
  /** Ya se escribió el monto a mano: deja de proponerse. */
  tocado: boolean;
}

interface LineaVuelto { moneda: MonedaEfectivo; monto: string; tasa: string }

const lineaVacia = (): Linea => ({ moneda: '', monto: '', tasa: '', bancoEmisor: '', bancoReceptor: '', referencia: '', tocado: false });

const numTxt = (n: number, dec = 2) => (Number.isFinite(n) ? String(Number(n.toFixed(dec))) : '');

/** Monto que cubre `usd` en esa moneda con esa tasa. */
function montoPara(moneda: Moneda, usd: number, tasa: number): number | null {
  if (!INFO_MONEDA[moneda].tasa) return r2(usd);
  if (!(tasa > 0)) return null;
  return INFO_MONEDA[moneda].unidad === 'COP' ? Math.round(usd * tasa) : r2(usd * tasa);
}

export function FormRegistro({ inicial, fechaInicial, tasas, onGuardado, onCancelar, enCaja }: {
  inicial?: Registro;
  fechaInicial?: string;
  tasas: Record<string, Tasas>;
  onGuardado?: (r: Registro) => void;
  onCancelar?: () => void;
  /** En la Caja: botones de plan grandes y el formulario se limpia al guardar. */
  enCaja?: boolean;
}) {
  const estado = useEstado();
  const { cambio } = useApp();
  const ui = useUI();
  const { manejarError } = useCierre();
  const periodos = usePeriodos();
  const afiliados = useAfiliados();
  const planes = estado.config.planes.filter((p) => p.activo || p.nombre === inicial?.plan);
  const bancos = estado.config.bancos;

  const [fecha, setFecha] = useState(inicial?.fecha ?? fechaInicial ?? hoyISO());
  const [afiliado, setAfiliado] = useState(inicial?.afiliado ?? '');
  const [plan, setPlan] = useState(inicial?.plan ?? '');
  const [tipo, setTipo] = useState<TipoRegistro>(inicial?.tipo ?? 'Nuevo');
  const [tipoTocado, setTipoTocado] = useState(!!inicial);
  const [convenio, setConvenio] = useState(inicial?.convenio ?? false);
  const [lineas, setLineas] = useState<Linea[]>(() => (inicial?.pagos.length
    ? inicial.pagos.map((p) => ({
      moneda: p.moneda, monto: String(p.monto), tasa: INFO_MONEDA[p.moneda].tasa ? String(p.tasa) : '',
      bancoEmisor: p.bancoEmisor ?? '', bancoReceptor: p.bancoReceptor ?? '', referencia: p.referencia ?? '', tocado: true,
    }))
    : [lineaVacia()]));
  const [vueltos, setVueltos] = useState<LineaVuelto[]>(() =>
    (inicial?.vueltos ?? []).map((v) => ({ moneda: v.moneda, monto: String(v.monto), tasa: v.moneda === 'Cop' ? String(v.tasa) : '' })));
  const [notas, setNotas] = useState(inicial?.notas ?? '');
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ txt: string; err?: boolean } | null>(null);

  useEffect(() => { if (!inicial && fechaInicial) setFecha(fechaInicial); }, [fechaInicial, inicial]);

  // Cierre de mes: los nuevos preguntan solos; las ediciones solo avisan.
  const guardiaNuevo = useGuardiaCierre(fecha, !inicial);
  const bloqueo = inicial ? bloqueoEdicion(periodos, inicial.fecha, fecha) : guardiaNuevo;

  const precio = tipo === 'Pago mixto' ? 0 : precioConConvenio(estado.config.planes, plan, convenio);

  // Monto propuesto: con una sola línea sin tocar, lo que cubre el precio.
  const visibles = useMemo(() => lineas.map((l, i) => {
    if (lineas.length !== 1 || i !== 0 || !l.moneda || l.tocado || !(precio > 0)) return l;
    const m = montoPara(l.moneda, precio, leerNumero(l.tasa));
    return m === null ? l : { ...l, monto: numTxt(m) };
  }), [lineas, precio]);

  const usdLinea = (l: Linea) => (l.moneda ? enUSD({ moneda: l.moneda, monto: leerNumero(l.monto) || 0, tasa: leerNumero(l.tasa) || 0 }) : 0);
  const usdVuelto = (v: LineaVuelto) => enUSD({ moneda: v.moneda, monto: leerNumero(v.monto) || 0, tasa: leerNumero(v.tasa) || 0 });
  const pagado = r2(visibles.reduce((s, l) => s + usdLinea(l), 0) - vueltos.reduce((s, v) => s + usdVuelto(v), 0));
  const diferencia = r2(pagado - precio);

  const cambiarLinea = (i: number, c: Partial<Linea>) =>
    setLineas((ls) => ls.map((l, k) => (k === i ? { ...visibles[k], ...c } : l)));

  const elegirMoneda = (i: number, m: Moneda) => {
    const sugerida = tasaSugerida(tasas, fecha, m);
    cambiarLinea(i, {
      moneda: m, tocado: lineas.length > 1 ? lineas[i].tocado : false,
      tasa: INFO_MONEDA[m].tasa ? (lineas[i].moneda && INFO_MONEDA[lineas[i].moneda as Moneda].tasaDe === INFO_MONEDA[m].tasaDe && lineas[i].tasa ? lineas[i].tasa : sugerida ? String(sugerida) : '') : '',
    });
  };

  const elegirAfiliado = (texto: string) => {
    setAfiliado(texto);
    const conocido = afiliados.find((a) => a.nombre.toLowerCase() === texto.trim().toLowerCase());
    if (!tipoTocado && !inicial) setTipo(conocido ? 'Renovación' : 'Nuevo');
    if (conocido && !plan && planes.some((p) => p.nombre === conocido.ultimoPlan)) setPlan(conocido.ultimoPlan);
  };

  const limpiar = () => {
    setAfiliado(''); setPlan(''); setTipo('Nuevo'); setTipoTocado(false); setConvenio(false);
    setLineas([lineaVacia()]); setVueltos([]); setNotas('');
  };

  const guardar = async () => {
    setMsg(null);
    if (!afiliado.trim()) return setMsg({ txt: 'Escribe el nombre del afiliado.', err: true });
    if (!plan) return setMsg({ txt: 'Elige el plan.', err: true });
    const pagos = visibles.filter((l) => l.moneda || l.monto);
    if (!pagos.length || pagos.some((l) => !l.moneda)) return setMsg({ txt: 'Elige la moneda de cada pago.', err: true });
    if (precio > 0 && diferencia < -0.01) {
      const ok = await ui.confirmar(
        `Lo pagado (${fmtUSD(pagado)}) no cubre el precio del plan (${fmtUSD(precio)}). Faltan ${fmtUSD(-diferencia)}.\n¿Registrar igual?`,
        { titulo: 'El pago no está completo', ok: 'Registrar igual' },
      );
      if (!ok) return;
    }
    const cuerpo = {
      fecha, afiliado: afiliado.trim(), plan, tipo, convenio, notas,
      pagos: pagos.map((l) => ({
        moneda: l.moneda, monto: leerNumero(l.monto), tasa: INFO_MONEDA[l.moneda as Moneda].tasa ? leerNumero(l.tasa) : 1,
        bancoEmisor: l.bancoEmisor, bancoReceptor: l.bancoReceptor, referencia: l.referencia.trim(),
      })),
      vueltos: vueltos.filter((v) => leerNumero(v.monto) > 0).map((v) => ({
        moneda: v.moneda, monto: leerNumero(v.monto), tasa: v.moneda === 'Cop' ? leerNumero(v.tasa) : 1,
      })),
    };
    setGuardando(true);
    try {
      const r = inicial
        ? await apiPut<{ registro: Registro }>(`/api/registros/${inicial.id}`, cuerpo)
        : await apiPost<{ registro: Registro }>('/api/registros', cuerpo);
      // La primera tasa que se usa en el día queda como "tasa del día".
      if (!inicial) {
        const nuevas: Tasas = { ...(tasas[fecha] ?? {}) };
        let hay = false;
        for (const p of cuerpo.pagos) {
          const de = INFO_MONEDA[p.moneda as Moneda].tasaDe;
          if (de && !nuevas[de] && p.tasa > 0) { nuevas[de] = p.tasa; hay = true; }
        }
        if (hay) await apiPut(`/api/tasas/${fecha}`, nuevas).catch(() => { /* no es grave */ });
      }
      cambio();
      ui.avisar(inicial ? 'Registro actualizado ✓' : `Pago de ${r.registro.afiliado} registrado ✓`, 'ok');
      if (enCaja && !inicial) limpiar();
      onGuardado?.(r.registro);
    } catch (e) {
      if (!manejarError(e, fecha)) setMsg({ txt: mensajeError(e), err: true });
    } finally {
      setGuardando(false);
    }
  };

  const efectivoSobra = diferencia > 0.009 && visibles.some((l) => l.moneda && esEfectivo(l.moneda));
  const opcionesAfiliado = useMemo(() => afiliados.map((a) => ({ id: a.nombre, label: a.nombre })), [afiliados]);
  const conocido = afiliados.find((a) => a.nombre.toLowerCase() === afiliado.trim().toLowerCase());

  return (
    <div>
      <Candado bloqueo={bloqueo} />

      <div className="form-grid">
        <div className="field">
          <label className="fl" htmlFor="f-fecha">Fecha</label>
          <input id="f-fecha" type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />
        </div>
        <div className="field" style={{ gridColumn: 'span 2' }}>
          <label className="fl">Afiliado *</label>
          <Autocomplete opciones={opcionesAfiliado} valor={afiliado} onCambiar={(t) => elegirAfiliado(t)} placeholder="Nombre y apellido" />
          {afiliado.trim() && (
            <small className="muted" style={{ fontSize: 11.5 }}>
              {conocido
                ? `Ya registrado · último plan ${conocido.ultimoPlan} (${conocido.ultimaFecha.split('-').reverse().join('/')})`
                : 'Afiliado nuevo'}
            </small>
          )}
        </div>
      </div>

      <div className="field">
        <label className="fl">Plan *</label>
        {enCaja ? (
          <div className="prod-grid">
            {planes.map((p) => (
              <button
                key={p.nombre} type="button" className={'prod-btn' + (plan === p.nombre ? ' sel' : '')}
                onClick={() => setPlan(p.nombre)}
              >
                <span>{p.nombre}</span>
                <b>{fmtUSD(p.precio)}</b>
              </button>
            ))}
          </div>
        ) : (
          <select value={plan} onChange={(e) => setPlan(e.target.value)}>
            <option value="">Elige el plan…</option>
            {planes.map((p) => <option key={p.nombre} value={p.nombre}>{`${p.nombre} — ${fmtUSD(p.precio)}`}</option>)}
            {inicial && !planes.some((p) => p.nombre === inicial.plan) && <option value={inicial.plan}>{inicial.plan}</option>}
          </select>
        )}
      </div>

      <div className="row" style={{ marginBottom: 10, alignItems: 'flex-end' }}>
        <div>
          <label className="fl">Tipo</label>
          <Segmentado
            opciones={TIPOS_REGISTRO} valor={tipo}
            onCambiar={(t) => { setTipo(t); setTipoTocado(true); }}
          />
        </div>
        <label className="chkline" style={{ paddingBottom: 8 }}>
          <input type="checkbox" checked={convenio} onChange={(e) => setConvenio(e.target.checked)} disabled={tipo === 'Pago mixto'} />
          Convenio (50%)
        </label>
      </div>
      {tipo === 'Pago mixto' && (
        <p className="msg info" style={{ marginTop: -4 }}>
          Pago mixto: dinero que completa otro pago (por ejemplo, lo que faltó). Suma al ingreso pero no cuenta como otro afiliado.
        </p>
      )}

      <div style={{ borderTop: '1px solid var(--line)', margin: '6px 0 10px', paddingTop: 10, display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span>Total del plan:</span>
        <b style={{ color: 'var(--gold)', fontSize: 18 }} className="num">{fmtUSD(precio)}</b>
        {plan && tipo !== 'Pago mixto' && <small className="muted">{`${plan}${convenio ? ' · convenio 50%' : ''}`}</small>}
      </div>

      <label className="fl" style={{ textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>¿Cómo pagó?</label>
      {visibles.map((l, i) => {
        const info = l.moneda ? INFO_MONEDA[l.moneda] : null;
        const usd = usdLinea(l);
        return (
          <div className="pago-linea" key={i}>
            <div className="cab">
              <Segmentado
                opciones={MONEDAS.map((m) => ({ v: m, l: m }))}
                valor={(l.moneda || '') as Moneda}
                onCambiar={(m) => elegirMoneda(i, m)}
              />
              {visibles.length > 1 && (
                <button className="btn sm danger" type="button" title="Quitar este pago"
                  onClick={() => setLineas((ls) => ls.filter((_, k) => k !== i))}>
                  <Ico name="x" />
                </button>
              )}
            </div>
            {l.moneda && (
              <div className="row">
                <div className="crece" style={{ maxWidth: 200 }}>
                  <label className="fl">{`Monto (${info!.unidad})`}</label>
                  <input
                    inputMode="decimal" className="num" value={l.monto} placeholder="0"
                    onChange={(e) => cambiarLinea(i, { monto: e.target.value, tocado: true })}
                  />
                </div>
                {info!.tasa && (
                  <div className="crece" style={{ maxWidth: 170 }}>
                    <label className="fl">{`Tasa (${info!.unidad} por $)`}</label>
                    <input
                      inputMode="decimal" className="num" value={l.tasa} placeholder="0"
                      onChange={(e) => cambiarLinea(i, { tasa: e.target.value })}
                    />
                  </div>
                )}
                <span className="eq num" style={{ alignSelf: 'flex-end', paddingBottom: 9 }}>{`= ${fmtUSD(r2(usd))}`}</span>
              </div>
            )}
            {info?.ref && (
              <div className="ref-box">
                {info.ref === 'banco' && (
                  <>
                    <div>
                      <label className="fl">Banco emisor *</label>
                      <select value={l.bancoEmisor} onChange={(e) => cambiarLinea(i, { bancoEmisor: e.target.value })}>
                        <option value="">Elige…</option>
                        {[...bancos, ...(l.bancoEmisor && !bancos.includes(l.bancoEmisor) ? [l.bancoEmisor] : [])].map((b) => <option key={b}>{b}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="fl">Banco receptor *</label>
                      <select value={l.bancoReceptor} onChange={(e) => cambiarLinea(i, { bancoReceptor: e.target.value })}>
                        <option value="">Elige…</option>
                        {[...bancos, ...(l.bancoReceptor && !bancos.includes(l.bancoReceptor) ? [l.bancoReceptor] : [])].map((b) => <option key={b}>{b}</option>)}
                      </select>
                    </div>
                  </>
                )}
                <div>
                  <label className="fl">{info.ref === 'banco' ? 'N° de referencia *' : 'N° de confirmación *'}</label>
                  <input value={l.referencia} onChange={(e) => cambiarLinea(i, { referencia: e.target.value })} autoComplete="off" />
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div className="row" style={{ marginBottom: 6 }}>
        <button className="btn sm ghost" type="button"
          onClick={() => setLineas((ls) => [...(ls.length === 1 ? [{ ...visibles[0], tocado: true }] : ls), lineaVacia()])}>
          <Ico name="plus" />Pagó con otra moneda
        </button>
        <button className="btn sm ghost" type="button"
          onClick={() => setVueltos((vs) => [...vs, { moneda: 'Dólares', monto: efectivoSobra ? numTxt(diferencia) : '', tasa: '' }])}>
          <Ico name="rotate" />Dar vuelto
        </button>
      </div>

      {vueltos.map((v, i) => (
        <div className="pago-linea" key={`v${i}`} style={{ borderStyle: 'dashed' }}>
          <div className="row">
            <b style={{ fontSize: 12.5 }}>Vuelto</b>
            <Segmentado
              opciones={['Dólares', 'Cop'] as const} valor={v.moneda}
              onCambiar={(m) => setVueltos((vs) => vs.map((x, k) => (k === i ? { ...x, moneda: m, tasa: m === 'Cop' ? String(tasaSugerida(tasas, fecha, 'Cop') ?? '') : '' } : x)))}
            />
            <input
              inputMode="decimal" className="num" style={{ width: 120 }} placeholder="Monto" value={v.monto}
              onChange={(e) => setVueltos((vs) => vs.map((x, k) => (k === i ? { ...x, monto: e.target.value } : x)))}
            />
            {v.moneda === 'Cop' && (
              <input
                inputMode="decimal" className="num" style={{ width: 110 }} placeholder="Tasa" value={v.tasa}
                onChange={(e) => setVueltos((vs) => vs.map((x, k) => (k === i ? { ...x, tasa: e.target.value } : x)))}
              />
            )}
            <button className="btn sm danger" type="button" onClick={() => setVueltos((vs) => vs.filter((_, k) => k !== i))}><Ico name="x" /></button>
          </div>
        </div>
      ))}

      {(pagado !== 0 || precio > 0) && <div className="pie-pago">
        {pagado === 0 && precio > 0 && <span>Total a cobrar: <b className="num">{fmtUSD(precio)}</b></span>}
        {pagado !== 0 && (precio === 0 || Math.abs(diferencia) <= 0.01) && <span className="pos"><Ico name="check" /> {`Pagado ${fmtUSD(pagado)}`}{precio > 0 ? ' · pago completo' : ''}</span>}
        {pagado !== 0 && precio > 0 && diferencia < -0.01 && <span className="neg">{`Faltan ${fmtUSD(-diferencia)} (pagado ${fmtUSD(pagado)} de ${fmtUSD(precio)})`}</span>}
        {pagado !== 0 && precio > 0 && diferencia > 0.01 && (
          <span className="warn">
            {`Sobran ${fmtUSD(diferencia)} (pagado ${fmtUSD(pagado)} de ${fmtUSD(precio)})`}
            {efectivoSobra && !vueltos.length ? ' · ¿hay que dar vuelto?' : ''}
          </span>
        )}
        {visibles.filter((l) => l.moneda && l.moneda !== 'Dólares' && leerNumero(l.monto) > 0).map((l, i) => (
          <div key={i} className="muted" style={{ fontSize: 11.5 }}>
            {`${fmtMonto(l.moneda as Moneda, leerNumero(l.monto))}${INFO_MONEDA[l.moneda as Moneda].tasa ? ` a ${fmtNum(leerNumero(l.tasa))}` : ''}`}
          </div>
        ))}
      </div>}

      <div className="field" style={{ marginTop: 10 }}>
        <label className="fl" htmlFor="f-notas">Notas</label>
        <input id="f-notas" value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Opcional" />
      </div>

      {msg && <p className={'msg ' + (msg.err ? 'err' : 'ok')}>{msg.txt}</p>}

      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
        {onCancelar && <button className="btn" onClick={onCancelar}>Cancelar</button>}
        <button
          className={'btn primary' + (enCaja ? ' lg block' : '')} onClick={() => void guardar()}
          disabled={guardando || !!bloqueo}
        >
          <Ico name="check" />
          {guardando ? 'Guardando…' : inicial ? 'Guardar cambios' : 'Registrar pago'}
        </button>
      </div>
      {!inicial && mesDe(fecha) !== mesDe(hoyISO()) && !bloqueo && (
        <p className="muted" style={{ fontSize: 12, textAlign: 'right' }}>Atención: la fecha no es de este mes.</p>
      )}
    </div>
  );
}
