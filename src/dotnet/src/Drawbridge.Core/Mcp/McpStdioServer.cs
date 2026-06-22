using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Drawbridge.Core;

/// <summary>Minimal MCP server over stdio (newline-delimited JSON-RPC 2.0). Handles
/// initialize / tools/list / tools/call. stdout carries protocol only; audit goes to
/// the sink (stderr). Tools are generated from config (dynamic), so a low-level loop
/// fits better than attribute-based registration.</summary>
public sealed class McpStdioServer
{
    private const string Version = "0.1.0";
    private static readonly JsonSerializerOptions PrettyRelaxed = new() { WriteIndented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
    private readonly DrawbridgeConfig _config;
    private readonly ConfigLoader.EnvLookup _env;
    private readonly IHttpClient _http;
    private readonly AuditSink _sink;
    private readonly IClock _clock;
    private readonly List<GeneratedTool> _tools;
    private readonly Dictionary<string, GeneratedTool> _byName;

    public McpStdioServer(DrawbridgeConfig config, ConfigLoader.EnvLookup env, IHttpClient http, AuditSink sink, IClock clock)
    {
        _config = config;
        _env = env;
        _http = http;
        _sink = sink;
        _clock = clock;
        _tools = ToolGenerator.Generate(config);
        _byName = _tools.ToDictionary(t => t.Name);
    }

    public async Task RunAsync(TextReader input, TextWriter output)
    {
        string? line;
        while ((line = await input.ReadLineAsync()) is not null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            JsonObject msg;
            try { msg = JsonNode.Parse(line)!.AsObject(); }
            catch { continue; }

            // A non-string method (or no method) means this isn't a request we handle.
            var method = (msg["method"] as JsonValue)?.GetValueKind() == JsonValueKind.String ? msg["method"]!.GetValue<string>() : null;
            var id = msg["id"];
            if (method is null) continue;

            // Never let a malformed/ill-typed frame crash the loop (§12): on error, reply
            // -32602 for a request, ignore for a notification.
            try
            {
                await Dispatch(output, method, id, msg);
            }
            catch (Exception e) when (id is not null)
            {
                RespondError(output, id, -32602, $"Invalid params: {e.Message}");
            }
            catch
            {
                // notification (no id) — swallow
            }
        }
    }

    private async Task Dispatch(TextWriter output, string method, JsonNode? id, JsonObject msg)
    {
        switch (method)
        {
            case "initialize":
                var pv = (msg["params"]?["protocolVersion"] as JsonValue)?.GetValueKind() == JsonValueKind.String
                    ? msg["params"]!["protocolVersion"]!.GetValue<string>() : "2025-06-18";
                Respond(output, id, new JsonObject
                {
                    ["protocolVersion"] = pv,
                    ["capabilities"] = new JsonObject { ["tools"] = new JsonObject() },
                    ["serverInfo"] = new JsonObject { ["name"] = "drawbridge", ["version"] = Version },
                    ["instructions"] = $"Drawbridge proxy (config version {_config.Version}). Tools are typed, allowlisted proxies to internal APIs; credentials stay server-side.",
                });
                break;
            case "notifications/initialized":
                break; // notification — no response
            case "ping":
                Respond(output, id, new JsonObject());
                break;
            case "tools/list":
                Respond(output, id, ToolsList());
                break;
            case "tools/call":
                Respond(output, id, await ToolsCall(msg["params"]?.AsObject() ?? []));
                break;
            default:
                if (id is not null) RespondError(output, id, -32601, $"Method not found: {method}");
                break;
        }
    }

    private JsonObject ToolsList()
    {
        var arr = new JsonArray();
        foreach (var t in _tools)
            arr.Add(new JsonObject { ["name"] = t.Name, ["description"] = t.Description, ["inputSchema"] = t.InputSchema.DeepClone() });
        return new JsonObject { ["tools"] = arr };
    }

    private async Task<JsonObject> ToolsCall(JsonObject prms)
    {
        var name = prms["name"]?.GetValue<string>() ?? "";
        var args = prms["arguments"]?.AsObject() ?? [];

        if (!_byName.TryGetValue(name, out var tool))
        {
            var refused = new ExecResult("refused", 0, 0, 0, false, null, null, "", "", "");
            AuditLogger.Write(_sink, AuditLogger.BuildRecord("", name, refused, _clock));
            return TextResult($"Unknown tool: {name}", isError: true);
        }

        var result = await Executor.Execute(_config, tool, args, _env, _http);
        AuditLogger.Write(_sink, AuditLogger.BuildRecord(tool.PlatformKey, tool.Operation.Name, result, _clock));

        if (result.Outcome == "ok")
        {
            var text = result.Data is JsonValue v && v.GetValueKind() == System.Text.Json.JsonValueKind.String
                ? v.GetValue<string>()
                : result.Data?.ToJsonString(PrettyRelaxed) ?? "";
            if (result.Truncated) text += "\n\n[response truncated]";
            return TextResult(text, isError: false);
        }
        return TextResult($"Upstream {result.Status} ({result.Outcome})" + (result.Message is not null ? ": " + result.Message : ""), isError: true);
    }

    private static JsonObject TextResult(string text, bool isError) => new()
    {
        ["content"] = new JsonArray(new JsonObject { ["type"] = "text", ["text"] = text }),
        ["isError"] = isError,
    };

    private static void Respond(TextWriter output, JsonNode? id, JsonObject result)
    {
        var msg = new JsonObject { ["jsonrpc"] = "2.0", ["id"] = id?.DeepClone(), ["result"] = result };
        output.Write(msg.ToJsonString() + "\n"); // LF only, matching Node + MCP convention
        output.Flush();
    }

    private static void RespondError(TextWriter output, JsonNode? id, int code, string message)
    {
        var msg = new JsonObject
        {
            ["jsonrpc"] = "2.0",
            ["id"] = id?.DeepClone(),
            ["error"] = new JsonObject { ["code"] = code, ["message"] = message },
        };
        output.Write(msg.ToJsonString() + "\n"); // LF only
        output.Flush();
    }
}
