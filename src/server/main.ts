import { Store } from "../domain/store.ts";
import { PdfLibComposer } from "../pdf/pdf-lib-composer.ts";
import { createApp } from "./app.ts";

const port = Number(process.env.PORT ?? 8787);
const store = new Store({ composer: new PdfLibComposer() });
const app = createApp(store, { enableTestRoutes: process.env.TICKETS_TEST === "1" });

app.listen(port, () => {
  console.log(`tickets server on http://localhost:${port}`);
});
