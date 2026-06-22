using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Json.Schema;

namespace Drawbridge.Core;

public static partial class ConfigValidator
{
    private static JsonSchema? _schema;

    public static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = false,
    };

    private static JsonSchema Schema => _schema ??= JsonSchema.FromText(File.ReadAllText(Paths.FindConfigSchema()));

    [GeneratedRegex(@"\{([^}]+)\}")]
    private static partial Regex Placeholder();

    /// <summary>Validate a raw config node (JSON Schema + the invariants the schema
    /// cannot express), returning the typed config. Throws ConfigException.</summary>
    public static DrawbridgeConfig Validate(JsonNode? raw)
    {
        var element = JsonSerializer.SerializeToElement(raw);
        var results = Schema.Evaluate(element, new EvaluationOptions { OutputFormat = OutputFormat.List });
        if (!results.IsValid)
        {
            var errs = (results.Details ?? [])
                .Where(d => d.Errors is { Count: > 0 })
                .SelectMany(d => d.Errors!.Select(e => $"  {d.InstanceLocation} {e.Value}"))
                .Distinct();
            throw new ConfigException("Config does not match schema:\n" + string.Join("\n", errs));
        }

        var config = raw.Deserialize<DrawbridgeConfig>(JsonOptions)
            ?? throw new ConfigException("Config deserialized to null.");

        CheckToolNameUniqueness(config);
        foreach (var (key, platform) in config.Platforms)
            foreach (var op in platform.Operations)
            {
                CheckPathParams(key, op);
                CheckValues(key, op);
            }
        return config;
    }

    private static void CheckToolNameUniqueness(DrawbridgeConfig config)
    {
        var seen = new Dictionary<string, string>();
        foreach (var (key, platform) in config.Platforms)
            foreach (var op in Naming.GeneratedOps(platform))
            {
                var name = Naming.ToolName(key, op);
                if (seen.TryGetValue(name, out var first))
                    throw new ConfigException($"Duplicate tool name \"{name}\" from {first} and {key}.{op.Name}.");
                seen[name] = $"{key}.{op.Name}";
            }
    }

    private static void CheckPathParams(string key, OperationConfig op)
    {
        var where = $"{key}.{op.Name}";
        if (op.Path.Contains("..")) throw new ConfigException($"{where}: path must not contain \"..\" segments.");

        var inPath = (op.Params ?? []).Where(p => p.In == "path").Select(p => p.Name).ToList();
        var tokens = Placeholder().Matches(op.Path).Select(m => m.Groups[1].Value).ToList();
        foreach (var t in tokens)
            if (!inPath.Contains(t))
                throw new ConfigException($"{where}: path placeholder {{{t}}} has no matching in:path param.");
        foreach (var p in inPath)
            if (!tokens.Contains(p))
                throw new ConfigException($"{where}: in:path param \"{p}\" does not appear in path template.");
        if (tokens.Distinct().Count() != tokens.Count)
            throw new ConfigException($"{where}: duplicate path placeholder.");
    }

    private static void CheckValues(string key, OperationConfig op)
    {
        foreach (var p in op.Params ?? [])
        {
            if (p.Default is null) continue;
            var where = $"{key}.{op.Name}.{p.Name}";
            if (p.Type == "enum")
            {
                var def = p.Default.GetValueKind() == JsonValueKind.String ? p.Default.GetValue<string>() : p.Default.ToJsonString();
                if (p.Enum is null || !p.Enum.Contains(def))
                    throw new ConfigException($"{where}: default \"{def}\" is not one of the enum members.");
            }
            else if (!TypeMatches(p.Type, p.Default))
            {
                throw new ConfigException($"{where}: default {p.Default.ToJsonString()} does not match type {p.Type}.");
            }
        }
    }

    private static bool TypeMatches(string type, JsonNode v)
    {
        var kind = v.GetValueKind();
        return type switch
        {
            "string" => kind == JsonValueKind.String,
            "boolean" => kind is JsonValueKind.True or JsonValueKind.False,
            "number" => kind == JsonValueKind.Number,
            // Match JS Number.isInteger: any integral numeric value (e.g. 1.0), not just long-lexical.
            "integer" => kind == JsonValueKind.Number && double.TryParse(v.ToJsonString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var d) && double.IsFinite(d) && d == Math.Truncate(d),
            "array" => kind == JsonValueKind.Array,
            _ => true,
        };
    }
}
