/**
 * nulo.ts — En el programa de escritorio la interfaz habla con el servidor
 * Node: el "servidor local" del navegador no hace falta y no se incluye.
 */
export const servidorLocal = null;
export const alCambiarFuera = (_f: () => void): (() => void) => () => { /* nada */ };
