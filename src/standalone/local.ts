import { Store } from '../domain/store.ts';
import { PdfLibComposer } from '../pdf/pdf-lib-composer.ts';
import { DEFAULT_PROJECT } from '../shared/picklists.ts';
import type { CreateGroupInput } from '../domain/group.ts';
import type { MoveDirection } from '../domain/board.ts';

let project = DEFAULT_PROJECT;
export function readProject(): string { return project; }
export function saveProject(value: string): void { project = value; }
const stores = new Map<string, Store>();
const urls = new Map<string, string>();
const database = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('tickets-standalone', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('projects');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(new Error('Não foi possível abrir o armazenamento local.'));
});
async function storeFor(name: string): Promise<Store> {
  if (stores.has(name)) return stores.get(name)!;
  const db = await database;
  const saved = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
    const request = db.transaction('projects').objectStore('projects').get(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const store = new Store({ composer: new PdfLibComposer() });
  if (saved) {
    for (const key of ['groups', 'tickets', 'batches', 'pdfBytes', 'idempotency', 'sheets']) {
      if (key in saved) Object.assign(store, { [key]: saved[key] });
    }
    // Drop obsolete NF-e lot fields from earlier standalone saves.
    for (const group of store.groups.values()) delete (group as unknown as Record<string, unknown>).batches;
    for (const ticket of store.tickets.values()) delete (ticket as unknown as Record<string, unknown>).batchCodes;
    for (const batch of store.batches) {
      for (const ticket of batch.tickets) delete (ticket as unknown as Record<string, unknown>).batchCodes;
    }
    store.board();
  }
  stores.set(name, store);
  return store;
}
async function persist(name: string, store: Store): Promise<void> {
  const db = await database;
  const snapshot = { groups: store.groups, tickets: store.tickets, batches: store.batches, pdfBytes: store.pdfBytes, idempotency: store.idempotency, sheets: store.rawSheets };
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('projects', 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(new Error('Não foi possível salvar os dados locais.'));
    try {
      transaction.objectStore('projects').put(snapshot, name);
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  });
}
export function pdfUrl(id: string): string {
  const store = stores.get(project)!;
  const key = `${project}:${id}`;
  if (!urls.has(key)) urls.set(key, URL.createObjectURL(new Blob([new Uint8Array(store.getPdf(id))], { type: 'application/pdf' })));
  return urls.get(key)!;
}

const settings = document.createElement('details');
settings.innerHTML = '<summary>API NF-e</summary><label>Endereço do serviço <input type="url" placeholder="http://localhost:8000" aria-label="Endereço da API NF-e"></label><p>Configure o serviço usado para consultar as notas fiscais.</p>';
document.getElementById('connection-settings')!.append(settings);
const endpoint = settings.querySelector('input')!;
endpoint.value = localStorage.getItem('tickets-nfe-url') ?? 'http://localhost:8000';
endpoint.addEventListener('change', () => localStorage.setItem('tickets-nfe-url', endpoint.value.trim()));

let queue: Promise<unknown> = Promise.resolve();
export function localFetch(path: string, init: RequestInit): Promise<Response> {
  const name = project;
  const operation = queue.then(async () => {
    try {
      if (path.startsWith('/api/nfe/')) {
        const base = new URL(endpoint.value);
        if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Use um endereço HTTP ou HTTPS.');
        return await fetch(`${base.href.replace(/\/$/, '')}/nfe/${path.split('/').pop()}`);
      }
      const store = await storeFor(name);
      const body = init.body ? JSON.parse(String(init.body)) : {};
      let result: unknown;
      if (path === '/api/board') result = store.board();
      else if (path === '/api/batches') result = { batches: store.listBatches() };
      else if (path === '/api/groups') {
        result = store.addGroup({ ...body, project: name } as CreateGroupInput);
      } else if (path.startsWith('/api/groups/') && init.method === 'DELETE') { store.deleteGroup(decodeURIComponent(path.split('/').pop()!)); result = store.board(); }
      else if (path.startsWith('/api/batches/') && init.method === 'DELETE') { store.deleteBatch(decodeURIComponent(path.split('/').pop()!)); result = { batches: store.listBatches() }; }
      else if (path === '/api/move') result = store.move(body.ticketId, body.sheetId, body.slot);
      else if (path === '/api/key-move') result = store.keyMove(body.ticketId, body.direction as MoveDirection);
      else if (path === '/api/auto-arrange') result = store.autoArrange();
      else if (path === '/api/print') result = await store.print(body.idempotencyKey);
      else throw new Error(`Unknown operation: ${path}`);
      if (init.body !== undefined || init.method === 'DELETE') await persist(name, store);
      return Response.json(result);
    } catch (error) {
      stores.delete(name); // Reload the last durable state if an operation or save failed.
      return Response.json({ error: { code: (error as { code?: string }).code, message: (error as Error).message } }, { status: 400 });
    }
  });
  queue = operation.catch(() => {});
  return operation;
}
