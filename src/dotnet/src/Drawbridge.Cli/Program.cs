using System.Text.Json;
using System.Text.Json.Nodes;
using Drawbridge.Core;

static string? Arg(string flag)
{
    var a = Environment.GetCommandLineArgs();
    for (var i = 0; i < a.Length - 1; i++)
        if (a[i] == flag) return a[i + 1];
    return null;
}

if (Environment.GetCommandLineArgs().Contains("generate"))
{
    var from = Arg("--from");
    if (from is null)
    {
        Console.Error.WriteLine("usage: drawbridge generate --from <openapi> [--platform <key>] [--out <config>]");
        return 2;
    }
    var text = File.ReadAllText(from);
    var doc = (from.EndsWith(".json", StringComparison.Ordinal) ? JsonNode.Parse(text) : Yaml.Parse(text))!.AsObject();
    var generated = OpenApiGenerator.Generate(doc, Arg("--platform") ?? "api");
    var json = generated.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
    var outPath = Arg("--out");
    if (outPath is not null) File.WriteAllText(outPath, json + "\n");
    else Console.Out.WriteLine(json);
    Console.Error.WriteLine("drawbridge: draft config generated — review and prune before exposing.");
    return 0;
}

var configPath = Arg("--config");
if (configPath is null)
{
    Console.Error.WriteLine("usage: drawbridge --config <path>");
    return 2;
}

ConfigLoader.EnvLookup env = n => Environment.GetEnvironmentVariable(n);

DrawbridgeConfig config;
try
{
    config = ConfigLoader.LoadFile(configPath, env);
}
catch (ConfigException e)
{
    Console.Error.WriteLine($"drawbridge: {e.Message}");
    return 1;
}

var server = new McpStdioServer(config, env, new FetchClient(), AuditLogger.DefaultSink(env), new SystemClock());
Console.Error.WriteLine("drawbridge: ready (stdio)");
await server.RunAsync(Console.In, Console.Out);
return 0;
