using System.Text.Json.Nodes;
using Drawbridge.Core;

namespace Drawbridge.Conformance;

/// <summary>Loads the shared, language-neutral golden fixtures under specs/fixtures.</summary>
public static class Fixtures
{
    public static readonly string SpecsDir = FindSpecs();

    private static string FindSpecs()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        for (var i = 0; i < 12 && dir is not null; i++)
        {
            var candidate = Path.Combine(dir.FullName, "specs", "fixtures");
            if (Directory.Exists(candidate)) return Path.Combine(dir.FullName, "specs");
            dir = dir.Parent;
        }
        throw new DirectoryNotFoundException("Could not locate specs/fixtures");
    }

    public static IEnumerable<JsonObject> Load(string kind)
    {
        var dir = Path.Combine(SpecsDir, "fixtures");
        foreach (var file in Directory.EnumerateFiles(dir, "*.json", SearchOption.AllDirectories))
        {
            if (file.EndsWith("fixture.schema.json", StringComparison.Ordinal)) continue;
            var node = JsonNode.Parse(File.ReadAllText(file))!.AsObject();
            node["__file"] = file;
            if (node["$kind"]?.GetValue<string>() == kind) yield return node;
        }
    }

    public static JsonNode? Config(JsonObject fx)
    {
        if (fx["config"] is { } inline) return inline.DeepClone();
        var rel = fx["config_ref"]!.GetValue<string>();
        var path = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(fx["__file"]!.GetValue<string>())!, rel));
        var text = File.ReadAllText(path);
        return path.EndsWith(".json", StringComparison.Ordinal) ? JsonNode.Parse(text) : Yaml.Parse(text);
    }

    public static ConfigLoader.EnvLookup Env(JsonObject fx)
    {
        var e = fx["env"]?.AsObject();
        return name => e is not null && e.TryGetPropertyValue(name, out var v) && v is not null ? v.GetValue<string>() : null;
    }
}
