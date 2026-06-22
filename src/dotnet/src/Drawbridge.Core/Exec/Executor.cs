using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Drawbridge.Core;

public sealed record ExecResult(
    string Outcome, int Status, long DurationMs, long Bytes, bool Truncated,
    JsonNode? Data, string? Message, string Host, string Path, string Method);

public sealed record BuiltRequest(
    HttpRequestData Request, string AuthHeaderName, int TimeoutMs, int MaxBytes, string Host, string Path);

public static partial class Executor
{
    // Relaxed encoder so non-ASCII/HTML chars are NOT \uXXXX-escaped — matches JSON.stringify.
    internal static readonly JsonSerializerOptions Relaxed = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    [GeneratedRegex(@"(Bearer|Basic)\s+\S+", RegexOptions.IgnoreCase)]
    private static partial Regex SchemeToken();

    private static IEnumerable<ParamConfig> Params(GeneratedTool t, string where) =>
        (t.Operation.Params ?? []).Where(p => p.In == where);

    /// <summary>Mirror Node's value(): a present key (even JSON null) counts as provided;
    /// only an absent key falls back to the default.</summary>
    private static (bool Provided, JsonNode? Value) Resolve(ParamConfig p, JsonObject args)
    {
        if (args.TryGetPropertyValue(p.Name, out var v)) return (true, v);
        if (p.Default is not null) return (true, p.Default);
        return (false, null);
    }

    private static string Scalar(JsonNode? n) =>
        n is null ? "null" : n.GetValueKind() == JsonValueKind.String ? n.GetValue<string>() : n.ToJsonString(Relaxed);

    /// <summary>encodeURIComponent-equivalent: EscapeDataString then restore the five marks
    /// JS leaves literal (! * ' ( )), so path/query bytes match Node exactly.</summary>
    private static string EscapeComponent(string s) =>
        Uri.EscapeDataString(s).Replace("%21", "!").Replace("%2A", "*").Replace("%27", "'").Replace("%28", "(").Replace("%29", ")");

    private static string StripOneTrailingSlash(string s) => s.EndsWith('/') ? s[..^1] : s;

    /// <summary>Build the outbound request (pure). Throws on a missing required arg.</summary>
    public static BuiltRequest BuildRequest(DrawbridgeConfig config, GeneratedTool tool, JsonObject args, ConfigLoader.EnvLookup env)
    {
        var platform = config.Platforms[tool.PlatformKey];
        var op = tool.Operation;

        var missing = (op.Params ?? [])
            .Where(p => !Resolve(p, args).Provided && (p.Required == true || p.In == "path"))
            .Select(p => p.Name).ToList();
        if (missing.Count > 0) throw new InvalidOperationException($"missing required argument(s): {string.Join(", ", missing)}");

        var path = op.Path;
        foreach (var p in Params(tool, "path"))
            path = path.Replace($"{{{p.Name}}}", EscapeComponent(Scalar(Resolve(p, args).Value)));

        var pairs = new List<string>();
        foreach (var p in Params(tool, "query"))
        {
            var (provided, value) = Resolve(p, args);
            if (!provided) continue;
            var items = value is JsonArray arr ? arr.Select(x => (JsonNode?)x) : [value];
            foreach (var item in items)
                pairs.Add($"{EscapeComponent(p.Name)}={EscapeComponent(Scalar(item))}");
        }
        var query = pairs.Count > 0 ? "?" + string.Join("&", pairs) : "";

        var headers = new Dictionary<string, string>(StringComparer.Ordinal);
        // Static config headers (e.g. User-Agent) first; auth/content-type set below win.
        foreach (var (k, v) in platform.Headers ?? [])
            headers[k.ToLowerInvariant()] = v;

        string? body = null;
        var bodyParams = Params(tool, "body").ToList();
        if (bodyParams.Count > 0)
        {
            var obj = new JsonObject();
            foreach (var p in bodyParams)
            {
                var (provided, value) = Resolve(p, args);
                if (provided) obj[p.Name] = value?.DeepClone();
            }
            body = obj.ToJsonString(Relaxed);
            headers["content-type"] = "application/json";
        }

        var auth = AuthInjector.Build(platform.Auth, env);
        headers[auth.Name.ToLowerInvariant()] = auth.Value;

        var baseUrl = StripOneTrailingSlash(platform.BaseUrl);
        var request = new HttpRequestData(op.Method, $"{baseUrl}{path}{query}", headers, body);
        var timeout = op.TimeoutMs ?? platform.TimeoutMs ?? config.Defaults?.TimeoutMs ?? DefaultLimits.TimeoutMs;
        var max = op.MaxResponseBytes ?? DefaultLimits.MaxResponseBytes;
        return new BuiltRequest(request, auth.Name.ToLowerInvariant(), timeout, max, new Uri(baseUrl).Authority, path);
    }

    private static string Classify(int status) =>
        status is >= 200 and < 300 ? "ok" : status is >= 400 and < 500 ? "client_error" : status >= 500 ? "server_error" : "error";

    /// <summary>Execute a tool call. Never throws — build/transport failures become a
    /// structured ExecResult so the call is always logged and returned as a tool error.</summary>
    public static async Task<ExecResult> Execute(
        DrawbridgeConfig config, GeneratedTool tool, JsonObject args, ConfigLoader.EnvLookup env,
        IHttpClient http, Func<long>? now = null)
    {
        now ??= () => Environment.TickCount64;
        var platform = config.Platforms[tool.PlatformKey];
        var secrets = SecretValues(platform.Auth, env);
        string Scrub(string m) => Redact(m, secrets);
        var method = tool.Operation.Method;
        var host = SafeHost(platform.BaseUrl);
        var path = tool.Operation.Path;
        var start = now();

        BuiltRequest built;
        try { built = BuildRequest(config, tool, args, env); }
        catch (Exception e) { return new ExecResult("error", 0, now() - start, 0, false, null, Scrub(e.Message), host, path, method); }
        host = built.Host;
        path = built.Path;

        int status;
        string bodyText;
        try
        {
            var res = await http.SendAsync(built.Request, built.TimeoutMs);
            status = res.Status;
            bodyText = res.Body;
        }
        catch (RequestTimeoutException) { return new ExecResult("timeout", 0, now() - start, 0, false, null, "request timed out", host, path, method); }
        catch (Exception e) { return new ExecResult("error", 0, now() - start, 0, false, null, Scrub(e.Message), host, path, method); }

        var duration = now() - start;
        long bytes = Encoding.UTF8.GetByteCount(bodyText);
        var truncated = false;
        if (bytes > built.MaxBytes) { bodyText = TruncateUtf8(bodyText, built.MaxBytes); truncated = true; }

        var outcome = Classify(status);
        var data = ParseMaybeJson(bodyText);
        string? message = null;
        if (outcome != "ok")
        {
            var raw = data is null ? "null"
                : data is JsonValue jv && jv.GetValueKind() == JsonValueKind.String ? jv.GetValue<string>()
                : data.ToJsonString(Relaxed);
            message = Scrub(raw);
            if (message.Length > 500) message = message[..500];
        }
        return new ExecResult(outcome, status, duration, bytes, truncated, data, message, host, path, method);
    }

    private static JsonNode? ParseMaybeJson(string text)
    {
        try { return JsonNode.Parse(text); }
        catch { return JsonValue.Create(text); }
    }

    private static string TruncateUtf8(string text, int maxBytes)
    {
        var buf = Encoding.UTF8.GetBytes(text);
        var end = Math.Min(maxBytes, buf.Length);
        while (end > 0 && (buf[end] & 0xC0) == 0x80) end--;
        return Encoding.UTF8.GetString(buf, 0, end);
    }

    private static List<string> SecretValues(AuthConfig auth, ConfigLoader.EnvLookup env)
    {
        var outp = new List<string>();
        if (auth.Type == "bearer" && auth.SecretEnv is not null)
        {
            if (env(auth.SecretEnv) is { } t) { outp.Add($"Bearer {t}"); outp.Add(t); }
        }
        else if (auth.Type == "header" && auth.SecretEnv is not null)
        {
            if (env(auth.SecretEnv) is { } t) outp.Add(t);
        }
        else if (auth.Type == "basic")
        {
            var u = auth.UsernameEnv is not null ? env(auth.UsernameEnv) : null;
            var p = auth.PasswordEnv is not null ? env(auth.PasswordEnv) : null;
            if (u is not null && p is not null)
            {
                var b = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{u}:{p}"));
                outp.Add($"Basic {b}"); outp.Add(b); outp.Add($"{u}:{p}"); outp.Add(p);
            }
        }
        return outp.Where(s => s.Length > 0).OrderByDescending(s => s.Length).ToList();
    }

    private static string Redact(string msg, List<string> secrets)
    {
        foreach (var s in secrets) msg = msg.Replace(s, "[redacted]");
        return SchemeToken().Replace(msg, "$1 [redacted]");
    }

    private static string SafeHost(string baseUrl)
    {
        try { return new Uri(StripOneTrailingSlash(baseUrl)).Authority; }
        catch { return ""; }
    }
}
