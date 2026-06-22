namespace Drawbridge.Core;

public sealed record HttpRequestData(string Method, string Url, Dictionary<string, string> Headers, string? Body);

public sealed record HttpResponseData(int Status, string Body);

/// <summary>Thrown by an IHttpClient when the request times out.</summary>
public sealed class RequestTimeoutException() : Exception("request timed out");

public interface IHttpClient
{
    Task<HttpResponseData> SendAsync(HttpRequestData req, int timeoutMs);
}

/// <summary>Default client backed by System.Net.Http. Maps a timeout to RequestTimeoutException.</summary>
public sealed class FetchClient(HttpClient? http = null) : IHttpClient
{
    private readonly HttpClient _http = http ?? new HttpClient();

    public async Task<HttpResponseData> SendAsync(HttpRequestData req, int timeoutMs)
    {
        using var cts = new CancellationTokenSource(timeoutMs);
        using var msg = new HttpRequestMessage(new HttpMethod(req.Method), req.Url);
        foreach (var (k, v) in req.Headers)
        {
            if (k.Equals("content-type", StringComparison.OrdinalIgnoreCase)) continue;
            msg.Headers.TryAddWithoutValidation(k, v);
        }
        if (req.Body is not null)
        {
            // Bare "application/json" (no "; charset=utf-8") to match Node's fetch header.
            msg.Content = new StringContent(req.Body, System.Text.Encoding.UTF8);
            msg.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/json");
        }

        try
        {
            using var res = await _http.SendAsync(msg, cts.Token);
            return new HttpResponseData((int)res.StatusCode, await res.Content.ReadAsStringAsync(cts.Token));
        }
        catch (OperationCanceledException) when (cts.IsCancellationRequested)
        {
            throw new RequestTimeoutException();
        }
    }
}
