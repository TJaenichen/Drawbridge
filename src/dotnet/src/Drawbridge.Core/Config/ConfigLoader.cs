using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Drawbridge.Core;

public static partial class ConfigLoader
{
    public delegate string? EnvLookup(string name);

    [GeneratedRegex(@"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")]
    private static partial Regex EnvRef();

    [GeneratedRegex(@"^https?://[^@\s]+\z")]
    private static partial Regex BaseUrlOk();

    /// <summary>Validate, then resolve a raw config node against the environment.
    /// Fails fast if any referenced env var (in ${...} or an auth *_env) is unset.</summary>
    public static DrawbridgeConfig Load(JsonNode? raw, EnvLookup env)
    {
        // Schema + invariants first (base_url ${...} literal is allowed by the schema).
        ConfigValidator.Validate(raw);

        var missing = new SortedSet<string>(StringComparer.Ordinal);
        var resolved = Interpolate(raw, env, missing);

        var config = resolved.Deserialize<DrawbridgeConfig>(ConfigValidator.JsonOptions)
            ?? throw new ConfigException("Config deserialized to null.");

        foreach (var platform in config.Platforms.Values)
        {
            var a = platform.Auth;
            foreach (var name in new[] { a.SecretEnv, a.UsernameEnv, a.PasswordEnv })
                if (name is not null && env(name) is null) missing.Add(name);
        }
        if (missing.Count > 0)
            throw new ConfigException($"Missing required environment variable(s): {string.Join(", ", missing)}");

        // Re-validate base_url AFTER interpolation (the schema only saw the ${...} literal).
        foreach (var (key, platform) in config.Platforms)
            if (!BaseUrlOk().IsMatch(platform.BaseUrl))
                throw new ConfigException($"platform \"{key}\": resolved base_url \"{platform.BaseUrl}\" must be http(s) with no inline userinfo.");

        return config;
    }

    public static JsonNode? ParseFile(string path, EnvLookup env)
    {
        var text = File.ReadAllText(path);
        return Path.GetExtension(path) == ".json" ? JsonNode.Parse(text) : Yaml.Parse(text);
    }

    public static DrawbridgeConfig LoadFile(string path, EnvLookup env) => Load(ParseFile(path, env), env);

    private static JsonNode? Interpolate(JsonNode? node, EnvLookup env, ISet<string> missing)
    {
        switch (node)
        {
            case JsonObject o:
                var obj = new JsonObject();
                foreach (var (k, v) in o) obj[k] = Interpolate(v, env, missing);
                return obj;
            case JsonArray a:
                var arr = new JsonArray();
                foreach (var item in a) arr.Add(Interpolate(item, env, missing));
                return arr;
            case JsonValue val:
                if (val.GetValueKind() == JsonValueKind.String)
                    return JsonValue.Create(ReplaceEnv(val.GetValue<string>(), env, missing));
                return val.DeepClone();
            default:
                return null;
        }
    }

    private static string ReplaceEnv(string s, EnvLookup env, ISet<string> missing) =>
        EnvRef().Replace(s, m =>
        {
            var v = env(m.Groups[1].Value);
            if (v is null) { missing.Add(m.Groups[1].Value); return ""; }
            return v;
        });
}
