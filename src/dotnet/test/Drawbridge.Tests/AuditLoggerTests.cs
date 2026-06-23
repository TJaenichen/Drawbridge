using System.Text.Json.Nodes;
using Drawbridge.Core;
using NUnit.Framework;

namespace Drawbridge.Tests;

[TestFixture]
public class AuditLoggerTests
{
    [Test]
    public void BuildRecord_has_all_fields_and_no_secret()
    {
        var result = new ExecResult("ok", 201, 12, 8, false, JsonNode.Parse("{\"id\":1}"), null, "host.internal", "/things", "POST");
        var record = AuditLogger.BuildRecord("plat", "create", result, new FixedClock());

        Assert.That(record["v"]!.GetValue<int>(), Is.EqualTo(1));
        Assert.That(record["platform"]!.GetValue<string>(), Is.EqualTo("plat"));
        Assert.That(record["operation"]!.GetValue<string>(), Is.EqualTo("create"));
        Assert.That(record["method"]!.GetValue<string>(), Is.EqualTo("POST"));
        Assert.That(record["host"]!.GetValue<string>(), Is.EqualTo("host.internal"));
        Assert.That(record["status"]!.GetValue<int>(), Is.EqualTo(201));
        Assert.That(record["outcome"]!.GetValue<string>(), Is.EqualTo("ok"));
        Assert.That(record["request_id"]!.GetValue<string>(), Is.EqualTo("fixed-id"));

        var json = record.ToJsonString();
        Assert.That(json, Does.Not.Contain("Bearer"));
        Assert.That(json, Does.Not.Contain("secret"));
    }

    [Test]
    public void DefaultSink_writes_to_stderr_and_appends_file_never_stdout()
    {
        var file = Path.GetTempFileName();
        File.Delete(file);
        var origErr = Console.Error;
        var origOut = Console.Out;
        var err = new StringWriter();
        var outw = new StringWriter();
        try
        {
            Console.SetError(err);
            Console.SetOut(outw);
            var sink = AuditLogger.DefaultSink(n => n == "DRAWBRIDGE_AUDIT_FILE" ? file : null);
            sink("{\"a\":1}");
            sink("{\"a\":2}");
        }
        finally
        {
            Console.SetError(origErr);
            Console.SetOut(origOut);
        }

        Assert.That(err.ToString(), Does.Contain("{\"a\":1}"));
        Assert.That(err.ToString(), Does.Contain("{\"a\":2}"));
        Assert.That(outw.ToString(), Is.Empty, "audit must never reach stdout");
        Assert.That(File.ReadAllText(file), Is.EqualTo("{\"a\":1}\n{\"a\":2}\n"));
        File.Delete(file);
    }

    [Test]
    public void ResolveAuditFile_prefers_env_override()
    {
        var path = AuditLogger.ResolveAuditFile(n => n == "DRAWBRIDGE_AUDIT_FILE" ? "/tmp/x.jsonl" : null, "/home/u");
        Assert.That(path, Is.EqualTo("/tmp/x.jsonl"));
    }

    [Test]
    public void ResolveAuditFile_falls_back_to_drawbridge_under_home()
    {
        var path = AuditLogger.ResolveAuditFile(_ => null, "/home/u");
        Assert.That(path, Is.EqualTo(Path.Combine("/home/u", ".drawbridge", "audit.jsonl")));
    }

    [Test]
    public void ResolveAuditFile_reads_home_from_env_like_node_homedir()
    {
        // Mirrors Node os.homedir(): USERPROFILE on Windows, HOME on Unix.
        var homeVar = OperatingSystem.IsWindows() ? "USERPROFILE" : "HOME";
        var path = AuditLogger.ResolveAuditFile(n => n == homeVar ? "/home/from-env" : null);
        Assert.That(path, Is.EqualTo(Path.Combine("/home/from-env", ".drawbridge", "audit.jsonl")));
    }

    [Test]
    public void DefaultSink_creates_default_path_under_home_and_never_stdout()
    {
        var home = Directory.CreateTempSubdirectory("drawbridge-home-").FullName;
        var origErr = Console.Error;
        var origOut = Console.Out;
        var outw = new StringWriter();
        try
        {
            Console.SetError(new StringWriter());
            Console.SetOut(outw);
            var sink = AuditLogger.DefaultSink(_ => null, home);
            sink("{\"a\":1}");
        }
        finally
        {
            Console.SetError(origErr);
            Console.SetOut(origOut);
        }

        var expected = Path.Combine(home, ".drawbridge", "audit.jsonl");
        Assert.That(outw.ToString(), Is.Empty, "audit must never reach stdout");
        Assert.That(File.ReadAllText(expected), Is.EqualTo("{\"a\":1}\n"));
        Directory.Delete(home, recursive: true);
    }

    [Test]
    public void DefaultSink_degrades_to_stderr_only_when_dir_uncreatable()
    {
        // home is a regular FILE, so creating <file>/.drawbridge must fail.
        var homeFile = Path.GetTempFileName();
        var origErr = Console.Error;
        var origOut = Console.Out;
        var err = new StringWriter();
        var outw = new StringWriter();
        try
        {
            Console.SetError(err);
            Console.SetOut(outw);
            var sink = AuditLogger.DefaultSink(_ => null, homeFile);
            Assert.DoesNotThrow(() => sink("{\"a\":1}"));
        }
        finally
        {
            Console.SetError(origErr);
            Console.SetOut(origOut);
        }

        Assert.That(outw.ToString(), Is.Empty, "audit must never reach stdout");
        Assert.That(err.ToString(), Does.Contain("audit file disabled"));
        Assert.That(File.Exists(Path.Combine(homeFile, ".drawbridge", "audit.jsonl")), Is.False);
        File.Delete(homeFile);
    }

    [Test]
    public void DefaultSink_degrades_once_when_appends_fail_after_dir_created()
    {
        // The parent dir is fine, but the audit FILE path is itself a directory, so every
        // append throws — exercising the post-start "write failed" branch + the one-time latch.
        var home = Directory.CreateTempSubdirectory("drawbridge-home-").FullName;
        Directory.CreateDirectory(Path.Combine(home, ".drawbridge", "audit.jsonl"));
        var origErr = Console.Error;
        var origOut = Console.Out;
        var err = new StringWriter();
        var outw = new StringWriter();
        try
        {
            Console.SetError(err);
            Console.SetOut(outw);
            var sink = AuditLogger.DefaultSink(_ => null, home); // dir create succeeds, announces destination
            Assert.DoesNotThrow(() => sink("{\"a\":1}"));
            Assert.DoesNotThrow(() => sink("{\"a\":2}"));
        }
        finally
        {
            Console.SetError(origErr);
            Console.SetOut(origOut);
        }

        Assert.That(outw.ToString(), Is.Empty, "audit must never reach stdout");
        var warnings = err.ToString().Split("write failed").Length - 1;
        Assert.That(warnings, Is.EqualTo(1), "one warning despite two failing appends");
        Directory.Delete(home, recursive: true);
    }
}
