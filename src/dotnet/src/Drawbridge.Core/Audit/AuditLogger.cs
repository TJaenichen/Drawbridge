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

    /// <summary>The audit file's location, relative to home, when no override is set.</summary>
    public const string DefaultAuditDir = ".drawbridge";
    public const string DefaultAuditFileName = "audit.jsonl";

    /// <summary>
    /// Resolve the audit file path: DRAWBRIDGE_AUDIT_FILE wins; otherwise the default
    /// ~/.drawbridge/audit.jsonl (uniform across OSes — the monitor's zero-config
    /// rendezvous file, DESIGN §10/§11). Home is resolved the same way Node's
    /// os.homedir() does — USERPROFILE on Windows, HOME on Unix (through the injectable
    /// env seam for testability/parity), with the OS user-profile dir as a fallback.
    /// </summary>
    public static string ResolveAuditFile(ConfigLoader.EnvLookup env, string? home = null)
    {
        // An empty/whitespace override (e.g. DRAWBRIDGE_AUDIT_FILE=$UNSET) means "use the default".
        var explicitPath = env("DRAWBRIDGE_AUDIT_FILE");
        if (!string.IsNullOrWhiteSpace(explicitPath)) return explicitPath;
        home ??= (OperatingSystem.IsWindows() ? env("USERPROFILE") : env("HOME"))
                 is { Length: > 0 } h ? h : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        return Path.Combine(home, DefaultAuditDir, DefaultAuditFileName);
    }

    // Owner-only permissions for the audit file/dir (ignored on Windows).
    private const UnixFileMode DirMode = UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute;
    private const UnixFileMode FileMode_ = UnixFileMode.UserRead | UnixFileMode.UserWrite;

    /// <summary>
    /// Default sink: writes every record to stderr, and appends to the audit file
    /// (<see cref="ResolveAuditFile"/>), announcing the destination on stderr at startup.
    /// The parent dir is created if missing (dir 0700 / file 0600, owner-only — ignored
    /// on Windows). A file that can't be created or written degrades to <b>stderr-only</b>
    /// with a one-time warning — a broken audit file must never take down the MCP server (§10).
    /// </summary>
    public static AuditSink DefaultSink(ConfigLoader.EnvLookup env, string? home = null)
    {
        var file = ResolveAuditFile(env, home);
        var fileOk = true;
        void Disable(string why, Exception e)
        {
            fileOk = false;
            Console.Error.WriteLine($"drawbridge: audit file disabled ({why}: {file}): {e.Message}");
        }
        try
        {
            var dir = Path.GetDirectoryName(file);
            if (!string.IsNullOrEmpty(dir))
            {
                if (OperatingSystem.IsWindows()) Directory.CreateDirectory(dir);
                else Directory.CreateDirectory(dir, DirMode);
            }
            Console.Error.WriteLine($"drawbridge: audit -> {file}");
        }
        catch (Exception e) { Disable("cannot create directory", e); }
        return line =>
        {
            Console.Error.WriteLine(line);
            if (!fileOk) return;
            try { AppendLine(file, line); }
            catch (Exception e) { Disable("write failed", e); }
        };
    }

    /// <summary>Append one line, creating the file owner-only (0600) on first write (Unix).</summary>
    private static void AppendLine(string file, string line)
    {
        var opts = new FileStreamOptions { Mode = FileMode.Append, Access = FileAccess.Write };
        if (!OperatingSystem.IsWindows()) opts.UnixCreateMode = FileMode_;
        using var fs = new FileStream(file, opts);
        using var sw = new StreamWriter(fs);
        sw.Write(line + "\n");
    }

    public static void Write(AuditSink sink, JsonObject record) => sink(record.ToJsonString());
}
