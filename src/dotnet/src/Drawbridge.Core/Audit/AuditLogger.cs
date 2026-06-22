using System.Text.Json.Nodes;

namespace Drawbridge.Core;

public interface IClock
{
    string IsoNow();
    string Uuid();
}

public sealed class SystemClock : IClock
{
    public string IsoNow() => DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
    public string Uuid() => Guid.NewGuid().ToString();
}

/// <summary>A sink receives one finished JSONL line. MUST NOT be stdout (reserved for MCP).</summary>
public delegate void AuditSink(string line);

public static class AuditLogger
{
    /// <summary>Build an audit record (JsonObject, fixed field order). No secrets/bodies.</summary>
    public static JsonObject BuildRecord(string platform, string operation, ExecResult r, IClock clock) => new()
    {
        ["v"] = 1,
        ["ts"] = clock.IsoNow(),
        ["platform"] = platform,
        ["operation"] = operation,
        ["method"] = r.Method,
        ["host"] = r.Host,
        ["path"] = r.Path,
        ["status"] = r.Status,
        ["duration_ms"] = r.DurationMs,
        ["outcome"] = r.Outcome,
        ["bytes"] = r.Bytes,
        ["request_id"] = clock.Uuid(),
    };

    /// <summary>Default sink: stderr, plus an append-only file when DRAWBRIDGE_AUDIT_FILE is set.</summary>
    public static AuditSink DefaultSink(ConfigLoader.EnvLookup env)
    {
        var file = env("DRAWBRIDGE_AUDIT_FILE");
        return line =>
        {
            Console.Error.WriteLine(line);
            if (file is not null) File.AppendAllText(file, line + "\n");
        };
    }

    public static void Write(AuditSink sink, JsonObject record) => sink(record.ToJsonString());
}
