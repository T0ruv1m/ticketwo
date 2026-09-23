import { Store } from "../domain/store.ts";
import { PdfLibComposer } from "../pdf/pdf-lib-composer.ts";
import { createApp } from "./app.ts";
import { HttpNfeLookupClient } from "./nfe.ts";
import { Sessions } from "./sessions.ts";

const port = Number(process.env.PORT ?? 8787);
const composer = new PdfLibComposer();
const sessions = new Sessions(() => new Store({ composer }));
// Defaults to the nfe-lookup dev server; set NFE_LOOKUP_URL= (empty) to disable.
const nfeBaseUrl = process.env.NFE_LOOKUP_URL !== undefined && process.env.NFE_LOOKUP_URL.trim() === ""
  ? undefined
  : (process.env.NFE_LOOKUP_URL ?? "http://localhost:5000");
const app = createApp(sessions, {
  enableTestRoutes: process.env.TICKETS_TEST === "1",
  nfeClient: nfeBaseUrl ? new HttpNfeLookupClient(nfeBaseUrl) : undefined,
});

app.listen(port, () => {
  console.log(`tickets server on http://localhost:${port}`);
});
