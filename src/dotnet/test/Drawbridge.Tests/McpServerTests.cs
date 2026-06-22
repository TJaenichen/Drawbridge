using System.Text.Json.Nodes;
using Drawbridge.Core;
using NUnit.Framework;

namespace Drawbridge.Tests;

internal sealed class FixedClock : IClock
{
    public string IsoNow() => "2026-01-01T00:00:00.000Z";
    public string Uuid() => "fixed-id";
}

[TestFixture]
public class McpServerTests
{
    private const string Cfg = """
        { "version": 1, "platforms": { "t": {
          "base_url": "http://svc.internal",
          "auth": { "type": "bearer", "secret_env": "TOK" },
          "operations": [
            { "name": "get", "description": "Get a thing.", "method": "GET", "path": "/things/{id}",
              "params": [{ "name": "id", "in": "path", "type": "integer", "required": true }] }
          ] } } }
        """;

    private static async Task<(List<JsonObject> responses, List<string> audit)> Run(string[] requests, IHttpClient http)
    {
        var env = H.Env(("TOK", "secret"));
        var config = H.Load(Cfg, env);
        var audit = new List<string>();
        var server = new McpStdioServer(config, env, http, line => audit.Add(line), new FixedClock());

        using var input = new StringReader(string.Join("\n", requests));
        using var output = new StringWriter();
        await server.RunAsync(input, output);

        var responses = output.ToString()
            .Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(l => JsonNode.Parse(l)!.AsObject())
            .ToList();
        return (responses, audit);
    }

    private static JsonObject ById(List<JsonObject> rs, int id) => rs.First(r => r["id"]?.GetValue<int>() == id);

    [Test]
    public async Task Initialize_advertises_server_info_and_tools_capability()
    {
        var (rs, _) = await Run(["""{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}"""], new StubClient(200, "{}"));
        var result = ById(rs, 1)["result"]!.AsObject();
        Assert.That(result["serverInfo"]!["name"]!.GetValue<string>(), Is.EqualTo("drawbridge"));
        Assert.That(result["capabilities"]!["tools"], Is.Not.Null);
        Assert.That(result["protocolVersion"]!.GetValue<string>(), Is.EqualTo("2025-06-18"));
    }

    [Test]
    public async Task ToolsList_returns_generated_tools()
    {
        var (rs, _) = await Run(["""{"jsonrpc":"2.0","id":2,"method":"tools/list"}"""], new StubClient(200, "{}"));
        var tools = ById(rs, 2)["result"]!["tools"]!.AsArray();
        Assert.That(tools.Select(t => t!["name"]!.GetValue<string>()), Does.Contain("t_get"));
    }

    [Test]
    public async Task ToolsCall_ok_returns_text()
    {
        var (rs, audit) = await Run(["""{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"t_get","arguments":{"id":5}}}"""], new StubClient(200, "{\"id\":5}"));
        var result = ById(rs, 3)["result"]!.AsObject();
        Assert.That(result["isError"]?.GetValue<bool>() ?? false, Is.False);
        Assert.That(result["content"]![0]!["text"]!.GetValue<string>(), Does.Contain("5"));
        Assert.That(JsonNode.Parse(audit[0])!["outcome"]!.GetValue<string>(), Is.EqualTo("ok"));
    }

    [Test]
    public async Task ToolsCall_unknown_is_refused_and_audited()
    {
        var (rs, audit) = await Run(["""{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"t_nope","arguments":{}}}"""], new StubClient(200, "{}"));
        var result = ById(rs, 4)["result"]!.AsObject();
        Assert.That(result["isError"]!.GetValue<bool>(), Is.True);
        Assert.That(result["content"]![0]!["text"]!.GetValue<string>(), Is.EqualTo("Unknown tool: t_nope"));
        Assert.That(JsonNode.Parse(audit[0])!["outcome"]!.GetValue<string>(), Is.EqualTo("refused"));
    }

    [Test]
    public async Task Unknown_method_returns_method_not_found()
    {
        var (rs, _) = await Run(["""{"jsonrpc":"2.0","id":6,"method":"frobnicate"}"""], new StubClient(200, "{}"));
        Assert.That(ById(rs, 6)["error"]!["code"]!.GetValue<int>(), Is.EqualTo(-32601));
    }

    [Test]
    public async Task Malformed_frame_does_not_crash_the_loop()
    {
        // A non-string method then a valid request: the loop must survive the bad frame.
        var (rs, _) = await Run(["""{"method":5}""", """{"jsonrpc":"2.0","id":7,"method":"ping"}"""], new StubClient(200, "{}"));
        Assert.That(ById(rs, 7)["result"], Is.Not.Null);
    }
}
