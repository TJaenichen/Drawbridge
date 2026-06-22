using System.Text.Json.Nodes;
using Drawbridge.Core;
using NUnit.Framework;

namespace Drawbridge.Conformance;

internal sealed class StubClient(int status, string body) : IHttpClient
{
    public Task<HttpResponseData> SendAsync(HttpRequestData req, int timeoutMs) =>
        Task.FromResult(new HttpResponseData(status, body));
}

[TestFixture]
public class ToolGenerationConformance
{
    private static IEnumerable<TestCaseData> Cases() =>
        Fixtures.Load("tools").Select(fx => new TestCaseData(fx).SetName("tools: " + fx["description"]!.GetValue<string>()));

    [TestCaseSource(nameof(Cases))]
    public void Generates_expected_tools(JsonObject fx)
    {
        var config = ConfigLoader.Load(Fixtures.Config(fx), Fixtures.Env(fx));
        var actual = new JsonArray(ToolGenerator.Generate(config)
            .Select(t => (JsonNode)new JsonObject { ["name"] = t.Name, ["description"] = t.Description, ["input_schema"] = t.InputSchema.DeepClone() })
            .ToArray());
        var expected = fx["expected_tools"]!.DeepClone();
        Assert.That(JsonEqual.DeepEquals(actual, expected), Is.True,
            () => $"actual=  {actual.ToJsonString()}\nexpected={expected!.ToJsonString()}");
    }
}

[TestFixture]
public class ConfigValidationConformance
{
    private static IEnumerable<TestCaseData> Valid() =>
        Fixtures.Load("config_valid").Select(fx => new TestCaseData(fx).SetName("valid: " + fx["description"]!.GetValue<string>()));

    private static IEnumerable<TestCaseData> Invalid() =>
        Fixtures.Load("config_invalid").Select(fx => new TestCaseData(fx).SetName("invalid: " + fx["description"]!.GetValue<string>()));

    [TestCaseSource(nameof(Valid))]
    public void Accepts(JsonObject fx) => Assert.DoesNotThrow(() => ConfigValidator.Validate(Fixtures.Config(fx)));

    [TestCaseSource(nameof(Invalid))]
    public void Rejects(JsonObject fx) => Assert.Throws<ConfigException>(() => ConfigValidator.Validate(Fixtures.Config(fx)));
}

[TestFixture]
public class GenerateConformance
{
    private static IEnumerable<TestCaseData> Cases() =>
        Fixtures.Load("generate").Select(fx => new TestCaseData(fx).SetName("generate: " + fx["description"]!.GetValue<string>()));

    [TestCaseSource(nameof(Cases))]
    public void Generates_expected_config(JsonObject fx)
    {
        var openapi = Fixtures.OpenApi(fx)!.AsObject();
        var config = OpenApiGenerator.Generate(openapi, fx["platform"]!.GetValue<string>());
        Assert.That(JsonEqual.DeepEquals(config, fx["expected_config"]), Is.True, () => $"actual={config.ToJsonString()}");
        Assert.DoesNotThrow(() => ConfigValidator.Validate(config));
    }
}

[TestFixture]
public class RequestConformance
{
    private static IEnumerable<TestCaseData> Cases() =>
        Fixtures.Load("request").Select(fx => new TestCaseData(fx).SetName("request: " + fx["description"]!.GetValue<string>()));

    [TestCaseSource(nameof(Cases))]
    public async Task Builds_and_maps(JsonObject fx)
    {
        var env = Fixtures.Env(fx);
        var config = ConfigLoader.Load(Fixtures.Config(fx), env);
        var call = fx["tool_call"]!.AsObject();
        var name = call["name"]!.GetValue<string>();
        var args = call["arguments"]!.AsObject();
        var tool = ToolGenerator.Generate(config).First(t => t.Name == name);

        var built = Executor.BuildRequest(config, tool, args, env);
        var er = fx["expected_request"]!.AsObject();

        Assert.That(built.Request.Method, Is.EqualTo(er["method"]!.GetValue<string>()));

        // Split path/query from the raw URL (avoid Uri normalization of %2F etc.).
        var baseUrl = config.Platforms[tool.PlatformKey].BaseUrl.TrimEnd('/');
        var rest = built.Request.Url[baseUrl.Length..];
        var qIdx = rest.IndexOf('?');
        var actualPath = qIdx >= 0 ? rest[..qIdx] : rest;
        var actualQuery = qIdx >= 0 ? rest[(qIdx + 1)..] : "";
        Assert.That(actualPath, Is.EqualTo(er["path"]!.GetValue<string>()));

        // Query as a decoded multiset.
        var actualQ = actualQuery.Length == 0 ? new List<string>() : actualQuery.Split('&')
            .Select(p => { var kv = p.Split('=', 2); return $"{Uri.UnescapeDataString(kv[0])}={Uri.UnescapeDataString(kv.ElementAtOrDefault(1) ?? "")}"; })
            .OrderBy(x => x).ToList();
        var expQ = new List<string>();
        foreach (var (k, v) in er["query"]?.AsObject() ?? [])
        {
            if (v is JsonArray arr) foreach (var item in arr) expQ.Add($"{k}={item!.GetValue<string>()}");
            else expQ.Add($"{k}={v!.GetValue<string>()}");
        }
        Assert.That(actualQ, Is.EqualTo(expQ.OrderBy(x => x).ToList()));

        foreach (var (k, v) in er["headers"]?.AsObject() ?? [])
            Assert.That(built.Request.Headers[k], Is.EqualTo(v!.GetValue<string>()));
        if (er["auth_header"] is { } ah)
            Assert.That(built.Request.Headers.ContainsKey(ah.GetValue<string>()) && built.Request.Headers[ah.GetValue<string>()].Length > 0, Is.True, "auth header present");
        if (er["body"] is { } body)
            Assert.That(JsonEqual.DeepEquals(JsonNode.Parse(built.Request.Body ?? "{}"), body), Is.True,
                () => $"body={built.Request.Body}");

        var stub = new StubClient(fx["stub_response"]!["status"]!.GetValue<int>(), fx["stub_response"]!["body"]!.GetValue<string>());
        var res = await Executor.Execute(config, tool, args, env, stub);
        if (fx["expected_result"] is { } expRes)
            Assert.That(JsonEqual.DeepEquals(res.Data, expRes), Is.True, () => $"data={res.Data?.ToJsonString()}");
        if (fx["expected_error"] is { } expErr)
        {
            Assert.That(res.Status, Is.EqualTo(expErr["status"]!.GetValue<int>()));
            Assert.That(res.Outcome, Is.EqualTo(expErr["outcome"]!.GetValue<string>()));
            if (expErr["message_contains"] is { } mc)
                Assert.That(res.Message, Does.Contain(mc.GetValue<string>()));
        }
    }
}
