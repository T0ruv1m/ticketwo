# nfe-lookup API

Service that returns structured NF-e data for a 44-digit access key.
It looks the XML up in Google Drive by filename and parses it on
demand — no database, no folder-structure assumptions.

Source: `~/projects/prototypes/nfe-lookup2`.

## Endpoint

`GET /nfe/{access_key}`

The key is normalized first: non-digits are stripped, then exactly 44
digits are required.

Example:

```bash
curl http://localhost:5000/nfe/31240100874929000140550010005216041964324179
```

`200 OK`:

```json
{
  "accessKey": "31240100874929000140550010005216041964324179",
  "nfeNumber": "521604",
  "volumes": 1,
  "batches": [
    { "code": "B23L0947", "expiry": "2025-06-30", "quantity": 20.0 }
  ],
  "source": "drive:31240100874929000140550010005216041964324179.xml"
}
```

| Field | Meaning |
|---|---|
| `accessKey` | The normalized 44-digit key as requested |
| `nfeNumber` | NF-e number, string (leading zeros preserved) |
| `volumes` | Total volumes (`qVol`); `null` when absent in the XML |
| `batches` | All lot entries (`nLote`, `dVal`, `qLote`) across items, in document order; duplicates preserved (a lot is a per-item fact) |
| `source` | Where the XML came from (informational) |

## Status codes

| Status | Meaning |
|---|---|
| `200` | Found and parsed |
| `400` | Key is not 44 digits after normalization |
| `404` | No XML file for that key |
| `422` | File exists but is not a parseable NF-e |
| `503` | Drive API unreachable or credentials missing |

## Integration with tickets2

Feed `POST /api/groups` (see `src/server/app.ts`) with:

- `id` ← `accessKey` (globally unique — the 44-digit key)
- `totalVolumes` ← `volumes`

`project` and `destination` are set by the caller; the lookup service
does not provide them. `batches` is not consumed today — it is carried
for the future ticket label.

Typical flow:

```ts
const nfe = await fetch(`http://nfe-lookup:5000/nfe/${key}`).then(r => r.json());
await api<{ duplicate: boolean }>("/api/groups", {
  id: nfe.accessKey,
  project: "...",
  totalVolumes: nfe.volumes ?? 0,
});
```

## Running the service

```bash
cd ~/projects/prototypes/nfe-lookup2
eval "$(bash scripts/gdrive_env.sh)"   # injects Drive credentials from rclone.conf
NFE_STORE=drive .venv/bin/python -m nfe_lookup.app
```

- Listens on port 5000 (`NFE_PORT` to change). Development server only;
  use gunicorn for anything persistent.
- Credentials come from the rclone OAuth refresh token via
  `GDRIVE_TOKEN_JSON` / `GDRIVE_CLIENT_ID` / `GDRIVE_CLIENT_SECRET`
  (never hardcode them). The Drive API is free; usage here is far below
  its rate limits (~2 calls per lookup).
- Latency is ~1.5 s per lookup (one Drive name query + one content
  fetch), regardless of how old the document is.
