using System.Text.Json.Nodes;
using Drawbridge.Core;

namespace Drawbridge.Tests;

internal sealed class StubClient(int status, string body) : IHttpClient
{
    public int Calls { get; private set; }
    public Task<HttpResponseData> SendAsync(HttpRequestData req, int timeoutMs)
    {
        Calls++;
        return Task.FromResult(new HttpResponseData(status, body));
    }
}

internal sealed class TimeoutClient : IHttpClient
{
    public Task<HttpResponseData> SendAsync(HttpRequestData req, int timeoutMs) => throw new RequestTimeoutException();
}

internal static class H
{
    public static ConfigLoader.EnvLookup Env(params (string, string)[] pairs)
    {
        var d = pairs.ToDictionary(p => p.Item1, p => p.Item2);
        return n => d.TryGetValue(n, out var v) ? v : null;
    }

    public static DrawbridgeConfig Load(string json, ConfigLoader.EnvLookup env) => ConfigLoader.Load(JsonNode.Parse(json), env);

    public static GeneratedTool Tool(DrawbridgeConfig config, string name) =>
        ToolGenerator.Generate(config).First(t => t.Name == name);

    public static JsonObject Args(string json) => JsonNode.Parse(json)!.AsObject();
}
