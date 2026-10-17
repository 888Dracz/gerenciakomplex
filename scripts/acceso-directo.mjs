/**
 * acceso-directo.mjs — Deja en el Escritorio un icono "Gerencia Komplex" que
 * abre el programa de un solo clic (arranca el servidor y, en cuanto está
 * listo, el propio servidor abre su ventana). La ventana negra del servidor
 * arranca minimizada.
 *
 * Se ejecuta solo la PRIMERA vez: después queda una marca en AppData y no se
 * vuelve a crear, así que si alguien borra el icono a propósito no reaparece.
 * Para rehacerlo a mano:  npm run acceso-directo -- --forzar
 *
 * (Adaptado de Dorado Club.) Nunca detiene el arranque: si algo falla, avisa y sigue.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOMBRE = 'Gerencia Komplex';
const DESTINO = path.join(RAIZ, 'Iniciar Gerencia Komplex.bat');

const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share');
const MARCA = path.join(LOCALAPPDATA, 'GerenciaKomplex', 'acceso-directo.creado');

const FORZAR = process.argv.includes('--forzar');

function icono() {
  for (const p of [path.join(RAIZ, 'web', 'public', 'app.ico'), path.join(RAIZ, 'server', 'public', 'app.ico')]) {
    if (fs.existsSync(p)) return p;
  }
  return DESTINO;
}

/** Comillas simples de PowerShell: dentro de '...' solo hay que doblarlas. */
const ps = (txt) => `'${String(txt).replace(/'/g, "''")}'`;

function main() {
  if (process.platform !== 'win32') return;
  if (!FORZAR && fs.existsSync(MARCA)) return;
  if (!fs.existsSync(DESTINO)) return;

  const guion = `
$ErrorActionPreference = 'Stop'
$escritorio = [Environment]::GetFolderPath('Desktop')
if (-not $escritorio) { Write-Output 'SIN-ESCRITORIO'; exit 0 }
$acceso = Join-Path $escritorio ${ps(NOMBRE + '.lnk')}
if ((Test-Path -LiteralPath $acceso) -and -not $${FORZAR ? 'true' : 'false'}) { Write-Output 'YA'; exit 0 }
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($acceso)
$lnk.TargetPath = ${ps(DESTINO)}
$lnk.WorkingDirectory = ${ps(RAIZ)}
$lnk.IconLocation = ${ps(icono())}
$lnk.WindowStyle = 7
$lnk.Description = 'Abre Gerencia Komplex: caja, registro de pagos y cuadre'
$lnk.Save()
Write-Output 'CREADO'
`;

  const tmp = path.join(os.tmpdir(), `komplex-acceso-${process.pid}.ps1`);
  let salida = '';
  try {
    fs.writeFileSync(tmp, guion, 'utf8');
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmp], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error((r.stderr || r.error?.message || '').trim());
    salida = (r.stdout || '').trim();
  } catch (e) {
    console.log('  (No se pudo crear el icono del Escritorio: ' + (e.message || e) + ')');
    return;
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* daba igual */ }
  }

  try {
    fs.mkdirSync(path.dirname(MARCA), { recursive: true });
    fs.writeFileSync(MARCA, new Date().toISOString() + '\n', 'utf8');
  } catch { /* sin marca se reintentará el próximo arranque */ }

  if (salida === 'CREADO') console.log(`  Listo: tienes un icono "${NOMBRE}" en el Escritorio para abrirlo de un clic.`);
}

main();
