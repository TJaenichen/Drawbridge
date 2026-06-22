using Drawbridge.Core;
using NUnit.Framework;

namespace Drawbridge.Tests;

[TestFixture]
public class AuthTests
{
    [Test]
    public void Bearer()
    {
        var h = AuthInjector.Build(new AuthConfig("bearer", "TOK", null, null, null), H.Env(("TOK", "abc")));
        Assert.That(h.Name, Is.EqualTo("authorization"));
        Assert.That(h.Value, Is.EqualTo("Bearer abc"));
    }

    [Test]
    public void Header_custom_name_raw_secret()
    {
        var h = AuthInjector.Build(new AuthConfig("header", "KEY", "X-Api-Key", null, null), H.Env(("KEY", "sk-1")));
        Assert.That(h.Name, Is.EqualTo("X-Api-Key"));
        Assert.That(h.Value, Is.EqualTo("sk-1"));
    }

    [Test]
    public void Basic_base64()
    {
        var h = AuthInjector.Build(new AuthConfig("basic", null, null, "U", "P"), H.Env(("U", "alice"), ("P", "pw")));
        Assert.That(h.Name, Is.EqualTo("authorization"));
        Assert.That(h.Value, Is.EqualTo("Basic " + Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("alice:pw"))));
    }

    [Test]
    public void Throws_when_env_unset() =>
        Assert.Throws<ConfigException>(() => AuthInjector.Build(new AuthConfig("bearer", "TOK", null, null, null), H.Env()));
}

[TestFixture]
public class LoaderTests
{
    private const string Cfg = """
        { "version": 1, "platforms": { "p": {
          "base_url": "${BASE}",
          "auth": { "type": "bearer", "secret_env": "TOK" },
          "operations": [{ "name": "op", "description": "d", "method": "GET", "path": "/p" }] } } }
        """;

    [Test]
    public void Interpolates_base_url()
    {
        var c = H.Load(Cfg, H.Env(("BASE", "https://svc.internal"), ("TOK", "t")));
        Assert.That(c.Platforms["p"].BaseUrl, Is.EqualTo("https://svc.internal"));
    }

    [Test]
    public void Fails_fast_on_unset_interpolated_var() =>
        Assert.That(Assert.Throws<ConfigException>(() => H.Load(Cfg, H.Env(("TOK", "t"))))!.Message, Does.Contain("BASE"));

    [Test]
    public void Fails_fast_on_unset_auth_var() =>
        Assert.That(Assert.Throws<ConfigException>(() => H.Load(Cfg, H.Env(("BASE", "https://svc.internal"))))!.Message, Does.Contain("TOK"));

    [Test]
    public void Rejects_userinfo_in_resolved_base_url() =>
        Assert.Throws<ConfigException>(() => H.Load(Cfg, H.Env(("BASE", "https://u:p@host"), ("TOK", "t"))));
}
