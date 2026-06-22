using System.Text;

namespace Drawbridge.Core;

public static class AuthInjector
{
    public sealed record AuthHeader(string Name, string Value);

    private static string Req(ConfigLoader.EnvLookup env, string? name)
    {
        var v = name is not null ? env(name) : null;
        return v ?? throw new ConfigException($"Auth env var \"{name}\" is not set.");
    }

    /// <summary>Build the auth header from config + environment. The secret is read here
    /// and never exposed to the model, the tool schema, or the audit log (§8c).</summary>
    public static AuthHeader Build(AuthConfig auth, ConfigLoader.EnvLookup env) => auth.Type switch
    {
        "bearer" => new AuthHeader("authorization", $"Bearer {Req(env, auth.SecretEnv)}"),
        "header" => new AuthHeader(auth.Name!, Req(env, auth.SecretEnv)),
        "basic" => new AuthHeader("authorization",
            $"Basic {Convert.ToBase64String(Encoding.UTF8.GetBytes($"{Req(env, auth.UsernameEnv)}:{Req(env, auth.PasswordEnv)}"))}"),
        _ => throw new ConfigException($"unknown auth type {auth.Type}"),
    };
}
