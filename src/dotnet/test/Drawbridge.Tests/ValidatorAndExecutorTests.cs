using System.Text.Json.Nodes;
using Drawbridge.Core;
using NUnit.Framework;

namespace Drawbridge.Tests;

[TestFixture]
public class ValidatorInvariantTests
{
    private static JsonNode Base() => JsonNode.Parse("""
        { "version": 1, "platforms": { "p": {
          "base_url": "https://x.internal",
          "auth": { "type": "bearer", "secret_env": "TOK" },
          "operations": [{ "name": "op", "description": "d", "method": "GET", "path": "/p" }] } } }
        """)!;

    [Test]
    public void Rejects_duplicate_tool_names_across_platforms()
    {
        var c = Base().AsObject();
        var plats = c["platforms"]!.AsObject();
        plats["a"] = JsonNode.Parse("""{ "base_url":"https://x.internal","auth":{"type":"bearer","secret_env":"T"},"operations":[{"name":"b_c","description":"d","method":"GET","path":"/x"}] }""");
        plats["a_b"] = JsonNode.Parse("""{ "base_url":"https://x.internal","auth":{"type":"bearer","secret_env":"T"},"operations":[{"name":"c","description":"d","method":"GET","path":"/x"}] }""");
        plats.Remove("p");
        Assert.That(Assert.Throws<ConfigException>(() => ConfigValidator.Validate(c))!.Message, Does.Contain("a_b_c"));
    }

    [Test]
    public void Rejects_path_placeholder_without_param()
    {
        var c = Base().AsObject();
        c["platforms"]!["p"]!["operations"]![0]!["path"] = "/items/{id}";
        Assert.That(Assert.Throws<ConfigException>(() => ConfigValidator.Validate(c))!.Message, Does.Contain("{id}"));
    }

    [Test]
    public void Rejects_enum_default_not_a_member()
    {
        var c = Base().AsObject();
        c["platforms"]!["p"]!["operations"]![0]!["params"] = JsonNode.Parse("""[{"name":"s","in":"query","type":"enum","enum":["open","closed"],"default":"nope"}]""");
        Assert.That(Assert.Throws<ConfigException>(() => ConfigValidator.Validate(c))!.Message, Does.Contain("enum members"));
    }

    [Test]
    public void Rejects_default_type_mismatch()
    {
        var c = Base().AsObject();
        c["platforms"]!["p"]!["operations"]![0]!["params"] = JsonNode.Parse("""[{"name":"n","in":"query","type":"integer","default":"x"}]""");
        Assert.That(Assert.Throws<ConfigException>(() => ConfigValidator.Validate(c))!.Message, Does.Contain("does not match type integer"));
    }
}

[TestFixture]
public class ExecutorTests
{
    private static string OneOp(string opExtra = "", string auth = """ "type":"bearer","secret_env":"T" """) => $$"""
        { "version": 1, "platforms": { "p": {
          "base_url": "http://x.internal",
          "auth": { {{auth}} },
          "operations": [{ "name": "op", "description": "d", "method": "GET", "path": "/p"{{opExtra}} }] } } }
        """;

    [Test]
    public async Task Maps_status_to_outcome()
    {
        var c = H.Load(OneOp(), H.Env(("T", "t")));
        var tool = H.Tool(c, "p_op");
        Assert.That((await Executor.Execute(c, tool, H.Args("{}"), H.Env(("T", "t")), new StubClient(200, "{}"))).Outcome, Is.EqualTo("ok"));
        Assert.That((await Executor.Execute(c, tool, H.Args("{}"), H.Env(("T", "t")), new StubClient(404, "{}"))).Outcome, Is.EqualTo("client_error"));
        Assert.That((await Executor.Execute(c, tool, H.Args("{}"), H.Env(("T", "t")), new StubClient(500, "{}"))).Outcome, Is.EqualTo("server_error"));
        Assert.That((await Executor.Execute(c, tool, H.Args("{}"), H.Env(("T", "t")), new StubClient(302, "{}"))).Outcome, Is.EqualTo("error"));
    }

    [Test]
    public async Task Maps_timeout()
    {
        var c = H.Load(OneOp(), H.Env(("T", "t")));
        var r = await Executor.Execute(c, H.Tool(c, "p_op"), H.Args("{}"), H.Env(("T", "t")), new TimeoutClient());
        Assert.That(r.Outcome, Is.EqualTo("timeout"));
    }

    [Test]
    public void Timeout_precedence()
    {
        long T(string defaults, string platTimeout, string opTimeout)
        {
            var json = $$"""
                { "version": 1, {{defaults}} "platforms": { "p": {
                  "base_url": "http://x.internal", {{platTimeout}}
                  "auth": { "type":"bearer","secret_env":"T" },
                  "operations": [{ "name":"op","description":"d","method":"GET","path":"/p"{{opTimeout}} }] } } }
                """;
            var c = H.Load(json, H.Env(("T", "t")));
            return Executor.BuildRequest(c, H.Tool(c, "p_op"), H.Args("{}"), H.Env(("T", "t"))).TimeoutMs;
        }
        Assert.That(T("\"defaults\":{\"timeout_ms\":1000},", "\"timeout_ms\":2000,", ",\"timeout_ms\":3000"), Is.EqualTo(3000));
        Assert.That(T("\"defaults\":{\"timeout_ms\":1000},", "\"timeout_ms\":2000,", ""), Is.EqualTo(2000));
        Assert.That(T("\"defaults\":{\"timeout_ms\":1000},", "", ""), Is.EqualTo(1000));
        Assert.That(T("", "", ""), Is.EqualTo(30000));
    }

    [Test]
    public async Task Truncates_on_utf8_boundary()
    {
        var c = H.Load(OneOp(",\"max_response_bytes\":10"), H.Env(("T", "t")));
        var r = await Executor.Execute(c, H.Tool(c, "p_op"), H.Args("{}"), H.Env(("T", "t")), new StubClient(200, string.Concat(Enumerable.Repeat("€", 20))));
        Assert.That(r.Truncated, Is.True);
        Assert.That((r.Data as JsonValue)!.GetValue<string>(), Is.EqualTo("€€€"));
    }

    [Test]
    public async Task Redacts_secret_from_error_message()
    {
        var c = H.Load(OneOp(), H.Env(("T", "supersecret")));
        var r = await Executor.Execute(c, H.Tool(c, "p_op"), H.Args("{}"), H.Env(("T", "supersecret")), new StubClient(401, "{\"error\":\"invalid token supersecret\"}"));
        Assert.That(r.Message, Does.Not.Contain("supersecret"));
        Assert.That(r.Message, Does.Contain("[redacted]"));
    }

    [Test]
    public async Task Missing_required_arg_is_structured_error()
    {
        var c = H.Load(OneOp(",\"params\":[{\"name\":\"id\",\"in\":\"path\",\"type\":\"integer\",\"required\":true}]").Replace("/p\"", "/p/{id}\""), H.Env(("T", "tok-9z")));
        var r = await Executor.Execute(c, H.Tool(c, "p_op"), H.Args("{}"), H.Env(("T", "tok-9z")), new StubClient(200, "{}"));
        Assert.That(r.Outcome, Is.EqualTo("error"));
        Assert.That(r.Message, Does.Contain("missing required argument"));
    }
}
