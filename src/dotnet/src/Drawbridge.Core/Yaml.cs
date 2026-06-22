using System.Globalization;
using System.Text.Json.Nodes;
using YamlDotNet.RepresentationModel;

namespace Drawbridge.Core;

/// <summary>Convert YAML to a System.Text.Json JsonNode with scalar type inference,
/// so the same JSON Schema validation applies to YAML and JSON configs alike.</summary>
public static class Yaml
{
    public static JsonNode? Parse(string text)
    {
        var stream = new YamlStream();
        stream.Load(new StringReader(text));
        if (stream.Documents.Count == 0) return null;
        return ToJsonNode(stream.Documents[0].RootNode);
    }

    private static JsonNode? ToJsonNode(YamlNode node) => node switch
    {
        YamlMappingNode map => MapNode(map),
        YamlSequenceNode seq => SeqNode(seq),
        YamlScalarNode scalar => ScalarNode(scalar),
        _ => null,
    };

    private static JsonObject MapNode(YamlMappingNode map)
    {
        var obj = new JsonObject();
        foreach (var (k, v) in map.Children)
            obj[((YamlScalarNode)k).Value!] = ToJsonNode(v);
        return obj;
    }

    private static JsonArray SeqNode(YamlSequenceNode seq)
    {
        var arr = new JsonArray();
        foreach (var item in seq.Children) arr.Add(ToJsonNode(item));
        return arr;
    }

    private static JsonNode? ScalarNode(YamlScalarNode s)
    {
        // Quoted scalars are always strings; plain scalars get YAML core-schema inference.
        if (s.Style is YamlDotNet.Core.ScalarStyle.SingleQuoted or YamlDotNet.Core.ScalarStyle.DoubleQuoted)
            return JsonValue.Create(s.Value ?? "");

        var v = s.Value;
        if (string.IsNullOrEmpty(v) || v is "null" or "~" or "Null" or "NULL") return null;
        if (v is "true" or "True" or "TRUE") return JsonValue.Create(true);
        if (v is "false" or "False" or "FALSE") return JsonValue.Create(false);
        if (long.TryParse(v, NumberStyles.Integer, CultureInfo.InvariantCulture, out var l)) return JsonValue.Create(l);
        if (double.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out var d)) return JsonValue.Create(d);
        return JsonValue.Create(v);
    }
}
