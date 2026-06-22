using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Drawbridge.Core;

/// <summary>OpenAPI -> draft Drawbridge config. Mirrors the Node generator; mapping
/// rules are the cross-language contract, locked by specs/fixtures/generate.</summary>
public static partial class OpenApiGenerator
{
    private static readonly string[] Scalar = ["string", "integer", "number", "boolean"];
    private static readonly string[] Methods = ["get", "post", "put", "patch", "delete"];

    [GeneratedRegex("([a-z0-9])([A-Z])")]
    private static partial Regex CamelBoundary();

    [GeneratedRegex(@"[\s-]+")]
    private static partial Regex WhitespaceHyphen();

    [GeneratedRegex("[^a-z0-9_]+")]
    private static partial Regex NonIdentifier();

    [GeneratedRegex(@"^(https?://|\$\{)[^@\s]+$")]
    private static partial Regex BaseUrlRe();

    /// <summary>Always yields a valid identifier (mirrors the Node snake()).</summary>
    private static string Snake(string s)
    {
        var t = CamelBoundary().Replace(s, "$1_$2");
        t = WhitespaceHyphen().Replace(t, "_").ToLowerInvariant();
        t = NonIdentifier().Replace(t, "_");
        return t.Trim('_');
    }

    private static string? Str(JsonNode? n) =>
        n is JsonValue v && v.GetValueKind() == JsonValueKind.String ? v.GetValue<string>() : null;

    private static string? NonEmpty(JsonNode? n) => Str(n) is { } s && s.Trim().Length > 0 ? s : null;

    private static bool BoolTrue(JsonNode? n) => n is JsonValue v && v.GetValueKind() == JsonValueKind.True;

    private static JsonObject Resolve(JsonNode? schema, JsonObject root)
    {
        if (schema is JsonObject o && o["$ref"] is { } refNode)
        {
            var refStr = refNode.GetValue<string>();
            var pointer = refStr.StartsWith("#/", StringComparison.Ordinal) ? refStr[2..] : refStr;
            var parts = pointer.Split('/');
            JsonNode? node = root;
            foreach (var p in parts) node = node?[p];
            return node?.AsObject() ?? [];
        }
        return schema?.AsObject() ?? [];
    }

    private static string ElementType(JsonObject schema)
    {
        if (schema["enum"] is not null) return "enum";
        var t = schema["type"]?.GetValue<string>();
        return t is not null && Scalar.Contains(t) ? t : "string";
    }

    private static string MapType(JsonObject schema)
    {
        if (schema["enum"] is not null) return "enum";
        if (schema["type"]?.GetValue<string>() == "array") return "array";
        return ElementType(schema);
    }

    private static JsonObject MapParam(string name, string location, JsonObject schema, bool required, JsonObject root)
    {
        var type = MapType(schema);
        var p = new JsonObject { ["name"] = name, ["in"] = location, ["type"] = type };
        if (type == "enum") p["enum"] = schema["enum"]!.DeepClone();
        if (type == "array")
        {
            var items = Resolve(schema["items"], root);
            var it = new JsonObject { ["type"] = ElementType(items) };
            if (items["enum"] is { } ie) it["enum"] = ie.DeepClone();
            p["items"] = it;
        }
        if (required) p["required"] = true;
        if (schema["default"] is { } def) p["default"] = def.DeepClone();
        return p;
    }

    private static JsonObject AuthFromSchemes(JsonObject? schemes)
    {
        if (schemes is null || schemes.Count == 0) return new JsonObject { ["type"] = "bearer", ["secret_env"] = "API_TOKEN" };
        var first = schemes.First();
        var scheme = first.Value!.AsObject();
        var baseName = Regex.Replace(first.Key.ToUpperInvariant(), "[^A-Z0-9]", "_");
        var type = scheme["type"]?.GetValue<string>();
        var sc = scheme["scheme"]?.GetValue<string>();
        var inn = scheme["in"]?.GetValue<string>();
        if (type == "http" && sc == "basic")
            return new JsonObject { ["type"] = "basic", ["username_env"] = $"{baseName}_USER", ["password_env"] = $"{baseName}_PASS" };
        if (type == "apiKey" && inn == "header")
            return new JsonObject { ["type"] = "header", ["name"] = Str(scheme["name"]) ?? "X-Api-Key", ["secret_env"] = $"{baseName}_KEY" };
        return new JsonObject { ["type"] = "bearer", ["secret_env"] = $"{baseName}_TOKEN" };
    }

    /// <summary>Generate a draft Drawbridge config object from an OpenAPI document.</summary>
    public static JsonObject Generate(JsonObject openapi, string platformKey)
    {
        var serverUrl = Str(openapi["servers"]?[0]?["url"]);
        // Only use a server URL the schema would accept; otherwise emit the editable sentinel.
        var baseUrl = serverUrl is not null && BaseUrlRe().IsMatch(serverUrl) ? serverUrl : "${BASE_URL}";
        var auth = AuthFromSchemes(openapi["components"]?["securitySchemes"]?.AsObject());

        var operations = new JsonArray();
        foreach (var (path, item) in openapi["paths"]?.AsObject() ?? [])
        {
            if (item is not JsonObject itemObj) continue;
            foreach (var method in Methods)
            {
                if (itemObj[method] is not JsonObject op) continue;
                var name = Snake(Str(op["operationId"]) ?? $"{method}_{path}");
                var description = NonEmpty(op["summary"]) ?? NonEmpty(op["description"]) ?? $"TODO: describe {name}";

                var prms = new JsonArray();
                foreach (var p in op["parameters"]?.AsArray() ?? [])
                {
                    if (p is not JsonObject po) continue;
                    var pname = Str(po["name"]);
                    var pin = Str(po["in"]);
                    if (pname is null || pin is null) continue; // skip malformed parameter
                    prms.Add(MapParam(pname, pin, Resolve(po["schema"], openapi), BoolTrue(po["required"]), openapi));
                }
                var bodySchema = Resolve(op["requestBody"]?["content"]?["application/json"]?["schema"], openapi);
                var reqd = bodySchema["required"]?.AsArray();
                foreach (var (propName, propSchema) in bodySchema["properties"]?.AsObject() ?? [])
                {
                    var required = reqd?.Any(x => Str(x) == propName) == true;
                    prms.Add(MapParam(propName, "body", Resolve(propSchema, openapi), required, openapi));
                }

                var operation = new JsonObject { ["name"] = name, ["description"] = description, ["method"] = method.ToUpperInvariant(), ["path"] = path };
                if (prms.Count > 0) operation["params"] = prms;
                operations.Add(operation);
            }
        }

        return new JsonObject
        {
            ["version"] = 1,
            ["platforms"] = new JsonObject { [platformKey] = new JsonObject { ["base_url"] = baseUrl, ["auth"] = auth, ["operations"] = operations } },
        };
    }
}
