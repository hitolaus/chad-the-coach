// A minimal client for Garmin's Personal API (developer.garmin.com/gc-developer-program/personal).
// The personal API key, a Worker secret, is exchanged for a 24-hour access token; there are no
// refresh tokens, so an expiring token is simply replaced by exchanging the key again.

export const TOKEN_KEY = "garmin-token";

const API_BASE = "https://personal.connectapi.garmin.com";
const TOKEN_URL = `${API_BASE}/personalapitoken-service/personal-api/personal-api-key/token`;
const KEY_PAGE = "https://connect.garmin.com/app/settings/personalApiToken";
// Get a new token this long before the current one expires.
const RENEW_MARGIN_SECONDS = 15 * 60;

export class GarminError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class GarminClient {
  constructor(
    private readonly kv: KVNamespace,
    private readonly apiKey: string | undefined,
    private readonly fetcher: Fetch = (input, init) => fetch(input, init)
  ) {}

  // Shared by concurrent calls, so the key is exchanged once rather than once per call.
  private token?: Promise<string>;

  async get<T = unknown>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    this.token ??= this.kv.get(TOKEN_KEY).then((token) => (token && !expiresSoon(token) ? token : this.newToken()));
    const pending = this.token;
    let token = await pending;

    const url = new URL(path, API_BASE);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let response = await this.request(url, token);
    if (response.status === 401) {
      if (this.token === pending) this.token = this.newToken();
      token = await this.token;
      response = await this.request(url, token);
    }

    if (response.status === 204) return {} as T;
    if (!response.ok) {
      throw new GarminError(`Garmin API error ${response.status} for ${url.pathname}`, response.status);
    }
    return (await response.json()) as T;
  }

  private request(url: URL, token: string): Promise<Response> {
    return this.fetcher(url.toString(), { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  }

  private async newToken(): Promise<string> {
    if (!this.apiKey) {
      throw new GarminError(
        `No Garmin API key is set. Create one at ${KEY_PAGE} and run: npx wrangler secret put GARMIN_API_KEY`
      );
    }
    const response = await this.fetcher(TOKEN_URL, { method: "POST", headers: { Authorization: `ApiKey ${this.apiKey}` } });
    // 401 is a malformed key, 404 one Garmin doesn't know (deleted or expired); anything else is Garmin's side.
    if (response.status === 401 || response.status === 404) {
      throw new GarminError(
        `Garmin refused the personal API key (${response.status}); it may have expired. Create a new one at ${KEY_PAGE} and run: npx wrangler secret put GARMIN_API_KEY`,
        response.status
      );
    }
    if (!response.ok) {
      throw new GarminError(`Garmin's token service failed (${response.status}); try again in a few minutes.`, response.status);
    }
    // Garmin answers with the bare token as text/plain.
    const token = (await response.text()).trim();
    await this.kv.put(TOKEN_KEY, token);
    return token;
  }
}

function expiresSoon(token: string): boolean {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const exp = JSON.parse(atob(part)).exp;
    return typeof exp !== "number" || Date.now() / 1000 > exp - RENEW_MARGIN_SECONDS;
  } catch {
    return true;
  }
}
