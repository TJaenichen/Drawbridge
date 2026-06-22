using Drawbridge.Core;

static string? Arg(string flag)
{
    var a = Environment.GetCommandLineArgs();
    for (var i = 0; i < a.Length - 1; i++)
        if (a[i] == flag) return a[i + 1];
    return null;
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
