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
}
