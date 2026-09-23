import type { Store } from "../domain/store.ts";

/**
 * One board per project. A project's Store is created on first use and shared
 * by everyone viewing that project; different projects never see each other's
 * queue, sheets, batches, or PDFs.
 */
export class Sessions {
  private readonly stores = new Map<string, Store>();

  constructor(private readonly create: () => Store) {}

  forProject(project: string): Store {
    let store = this.stores.get(project);
    if (!store) {
      store = this.create();
      this.stores.set(project, store);
    }
    return store;
  }

  reset(): void {
    for (const store of this.stores.values()) store.reset();
    this.stores.clear();
  }
}
