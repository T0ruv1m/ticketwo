export interface NfeLookupResult {
  accessKey: string;
  nfeNumber: string;
  volumes: number | null;
  batches: { code: string; expiry: string; quantity: number }[];
  source: string;
}

export class NfeLookupError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "NfeLookupError";
    this.status = status;
    this.code = code;
  }
}

export function normalizeAccessKey(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 44) {
    throw new NfeLookupError(400, "invalid-access-key", "access key must be exactly 44 digits");
  }
  return digits;
}

export interface NfeLookupClient {
  lookup(accessKey: string): Promise<NfeLookupResult>;
}

const STATUS_CODES: Record<number, string> = {
  400: "invalid-access-key",
  404: "nfe-not-found",
  422: "nfe-unparseable",
  503: "nfe-unavailable",
};

export class HttpNfeLookupClient implements NfeLookupClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
  }

  async lookup(accessKey: string): Promise<NfeLookupResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/nfe/${encodeURIComponent(accessKey)}`);
    } catch (error) {
      throw new NfeLookupError(502, "nfe-unreachable", `nfe-lookup unreachable: ${(error as Error).message}`);
    }
    const body = (await response.json().catch(() => ({}))) as
      | (NfeLookupResult & { error?: { message?: string } })
      | { error?: { message?: string } };
    if (!response.ok) {
      const code = STATUS_CODES[response.status] ?? "nfe-unavailable";
      const message =
        (body as { error?: { message?: string } }).error?.message ?? `nfe-lookup returned ${response.status}`;
      throw new NfeLookupError(response.status, code, message);
    }
    return body as NfeLookupResult;
  }
}
