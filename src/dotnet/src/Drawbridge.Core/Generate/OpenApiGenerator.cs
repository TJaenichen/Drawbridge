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

    private static string Snake(string s) =>
        CamelBoundary().Replace(s, "$1_$2").Replace(" ", "_").Replace("-", "_").ToLowerInvariant();

    private static JsonObject Resolve(JsonNode? schema, JsonObject root)
    {
        if (schema is JsonObject o && o["$ref"] is { } refNode)
        {
            var parts = refNode.GetValue<string>().TrimStart('#', '/').Split('/');
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
            return new JsonObject { ["type"] = "header", ["name"] = scheme["name"]!.GetValue<string>(), ["secret_env"] = $"{baseName}_KEY" };
        return new JsonObject { ["type"] = "bearer", ["secret_env"] = $"{baseName}_TOKEN" };
    }

    /// <summary>Generate a draft Drawbridge config object from an OpenAPI document.</summary>
    public static JsonObject Generate(JsonObject openapi, string platformKey)
    {
        var baseUrl = openapi["servers"]?[0]?["url"]?.GetValue<string>() ?? "${BASE_URL}";
        var auth = AuthFromSchemes(openapi["components"]?["securitySchemes"]?.AsObject());

        var operations = new JsonArray();
        foreach (var (path, item) in openapi["paths"]?.AsObject() ?? [])
        {
            var itemObj = item!.AsObject();
            foreach (var method in Methods)
            {
                if (itemObj[method] is not JsonObject op) continue;
                var name = Snake(op["operationId"]?.GetValue<string>() ?? $"{method}_{path}");
                var description = op["summary"]?.GetValue<string>() ?? op["description"]?.GetValue<string>() ?? $"TODO: describe {name}";

                var prms = new JsonArray();
                foreach (var p in op["parameters"]?.AsArray() ?? [])
                {
                    var po = p!.AsObject();
                    prms.Add(MapParam(po["name"]!.GetValue<string>(), po["in"]!.GetValue<string>(),
                        Resolve(po["schema"], openapi), po["required"]?.GetValue<bool>() == true, openapi));
                }
                var bodySchema = Resolve(op["requestBody"]?["content"]?["application/json"]?["schema"], openapi);
                var reqd = bodySchema["required"]?.AsArray();
                foreach (var (propName, propSchema) in bodySchema["properties"]?.AsObject() ?? [])
                {
                    var required = reqd?.Any(x => x!.GetValue<string>() == propName) == true;
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
