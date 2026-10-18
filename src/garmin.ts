// A minimal Garmin Connect client: the same DI OAuth2 tokens and native-app headers that
// python-garminconnect (>= 0.3) uses. Logging in needs a browser-like TLS fingerprint, so that
// happens once on a computer (scripts/garmin_login.py); the Worker only refreshes and calls the API.

export const TOKENS_KEY = "garmin-tokens";

const API_BASE = "https://connectapi.garmin.com";
const DI_TOKEN_URL = "https://diauth.garmin.com/di-oauth2-service/oauth/token";
// Refresh this long before the access token expires, as python-garminconnect does.
const REFRESH_MARGIN_SECONDS = 15 * 60;

const NATIVE_HEADERS = {
  "User-Agent": "GCM-Android-5.23",
  "X-Garmin-User-Agent":
    "com.garmin.android.apps.connectmobile/5.23; ; Google/sdk_gphone64_arm64/google; Android/33; Dalvik/2.1.0",
  "X-Garmin-Paired-App-Version": "10861",
  "X-Garmin-Client-Platform": "Android",
  "X-App-Ver": "10861",
  "X-Lang": "en",
  "X-GCExperience": "GC5",
  "Accept-Language": "en-US,en;q=0.9"
};

export interface GarminTokens {
  di_token: string;
  di_refresh_token: string;
  di_client_id: string;
}

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
    private readonly fetcher: Fetch = (input, init) => fetch(input, init)
  ) {}

  // Shared by concurrent calls, so a refresh happens once: Garmin rotates the refresh token,
  // and a second refresh with the old one would fail.
  private tokens?: Promise<GarminTokens>;

  async get<T = unknown>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    this.tokens ??= this.loadTokens().then((tokens) => (expiresSoon(tokens.di_token) ? this.refresh(tokens) : tokens));
    const pending = this.tokens;
    let tokens = await pending;

    const url = new URL(path, API_BASE);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let response = await this.request(url, tokens);
    if (response.status === 401) {
      if (this.tokens === pending) this.tokens = this.refresh(tokens);
      tokens = await this.tokens;
      response = await this.request(url, tokens);
    }

    if (response.status === 204) return {} as T;
    if (!response.ok) {
      const hint =
        response.status === 403 ? " (Garmin may be blocking requests from this server rather than the token)" : "";
      throw new GarminError(`Garmin API error ${response.status} for ${url.pathname}${hint}`, response.status);
    }
    return (await response.json()) as T;
  }

  private request(url: URL, tokens: GarminTokens): Promise<Response> {
    return this.fetcher(url.toString(), {
      headers: { ...NATIVE_HEADERS, Authorization: `Bearer ${tokens.di_token}`, Accept: "application/json" }
    });
  }

  private async loadTokens(): Promise<GarminTokens> {
    const tokens = await this.kv.get<GarminTokens>(TOKENS_KEY, "json");
    if (!tokens?.di_token || !tokens.di_refresh_token || !tokens.di_client_id) {
      throw new GarminError("Not connected to Garmin. Run scripts/garmin_login.py to sign in.");
    }
    return tokens;
  }

  private async refresh(tokens: GarminTokens): Promise<GarminTokens> {
    const response = await this.fetcher(DI_TOKEN_URL, {
      method: "POST",
      headers: {
        ...NATIVE_HEADERS,
        Authorization: `Basic ${btoa(`${tokens.di_client_id}:`)}`,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "Cache-Control": "no-cache"
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: tokens.di_client_id,
        refresh_token: tokens.di_refresh_token
      })
    });
    if (!response.ok) {
      throw new GarminError(
        `Garmin token refresh failed (${response.status}). Run scripts/garmin_login.py to sign in again.`,
        response.status
      );
    }
    const data = (await response.json()) as { access_token: string; refresh_token?: string };
    const refreshed: GarminTokens = {
      di_token: data.access_token,
      // Garmin rotates the refresh token; keep the old one only if it didn't send a new one.
      di_refresh_token: data.refresh_token ?? tokens.di_refresh_token,
      di_client_id: jwtClientId(data.access_token) ?? tokens.di_client_id
    };
    await this.kv.put(TOKENS_KEY, JSON.stringify(refreshed));
    return refreshed;
  }
}

function jwtPayload(token: string): Record<string, unknown> | undefined {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(part));
  } catch {
    return undefined;
  }
}

function expiresSoon(token: string): boolean {
  const exp = jwtPayload(token)?.exp;
  return typeof exp === "number" && Date.now() / 1000 > exp - REFRESH_MARGIN_SECONDS;
}

function jwtClientId(token: string): string | undefined {
  const clientId = jwtPayload(token)?.client_id;
  return typeof clientId === "string" ? clientId : undefined;
}
