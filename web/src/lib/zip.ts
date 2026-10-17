/**
 * zip.ts — ZIP mínimo y utilidades XML, compartidos por los exportadores.
 *
 * Tanto un .xlsx como un .docx son un ZIP de archivos XML (OOXML). Aquí está la
 * parte común: el contenedor ZIP en modo "store" (sin comprimir, que es válido
 * y ahorra traerse una librería de deflate) y el escapado de XML.
 */

export const enc = new TextEncoder();

// ---- CRC32 (tabla precalculada) ----
let CRC_TABLE: Uint32Array | null = null;

export function crc32(bytes: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

const u16 = (n: number) => [n & 0xFF, (n >>> 8) & 0xFF];
const u32 = (n: number) => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];

export interface ArchivoZip { name: string; data: Uint8Array }

/** Empaqueta los archivos en un ZIP sin compresión. */
export function zipStore(files: ArchivoZip[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const data = f.data;
    const crc = crc32(data);
    const size = data.length;
    const local = new Uint8Array(([] as number[]).concat(
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0)));
    chunks.push(local, nameBytes, data);
    central.push(new Uint8Array(([] as number[]).concat(
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(nameBytes.length),
      u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset))));
    central.push(nameBytes);
    offset += local.length + nameBytes.length + size;
  }
  const centralStart = offset;
  let centralSize = 0;
  for (const c of central) { chunks.push(c); centralSize += c.length; }
  chunks.push(new Uint8Array(([] as number[]).concat(
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralSize), u32(centralStart), u16(0))));

  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

/** Escapa un valor para meterlo en un atributo o nodo de texto XML. */
export const xmlEsc = (s: unknown): string => String(s).replace(/[<>&'"]/g, (c) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string));

/** Lanza la descarga de un archivo binario ya generado. */
export function descargarBinario(nombre: string, bytes: Uint8Array, mime: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  // Sin tildes ni rayas largas: hay navegadores que descartan el nombre si las trae.
  a.download = nombre.normalize('NFD').replace(/\p{Mn}/gu, '').replace(/[—–]/g, '-').replace(/[^\x20-\x7E]/g, '');
  a.style.display = 'none';
  // Dentro del documento: algunos navegadores ignoran el nombre si el enlace está suelto.
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
