export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  body: string;
}

export class TimeoutError extends Error {
  constructor() {
    super("request timed out");
    this.name = "TimeoutError";
  }
}

/** Sends a request; throws TimeoutError on timeout. Injected so tests use a stub. */
export type HttpClient = (req: HttpRequest, timeoutMs: number) => Promise<HttpResponse>;

/** Default client backed by global fetch + AbortController. */
export const fetchClient: HttpClient = async (req, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal: controller.signal,
    });
    return { status: res.status, body: await res.text() };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new TimeoutError();
    throw e;
  } finally {
    clearTimeout(timer);
  }
};
