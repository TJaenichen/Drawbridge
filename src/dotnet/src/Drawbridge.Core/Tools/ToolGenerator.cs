using System.Text.Json.Nodes;

namespace Drawbridge.Core;

public static class ToolGenerator
{
    private static JsonObject ElementSchema(string type, string[]? members)
    {
        if (type == "enum") return new JsonObject { ["type"] = "string", ["enum"] = ToArray(members) };
        return new JsonObject { ["type"] = type };
    }

    private static JsonArray ToArray(IEnumerable<string>? members)
    {
        var a = new JsonArray();
        foreach (var m in members ?? []) a.Add(m);
        return a;
    }

    /// <summary>Map one flattened param to its JSON Schema property.</summary>
    private static JsonObject ParamSchema(ParamConfig p)
    {
        JsonObject s = p.Type switch
        {
            "array" => new JsonObject { ["type"] = "array", ["items"] = ElementSchema(p.Items!.Type, p.Items.Enum) },
            "enum" => new JsonObject { ["type"] = "string", ["enum"] = ToArray(p.Enum) },
            _ => new JsonObject { ["type"] = p.Type },
        };
        if (p.Description is not null) s["description"] = p.Description;
        if (p.Default is not null) s["default"] = p.Default.DeepClone();
        return s;
    }

    /// <summary>Build the flat MCP tool input schema for an operation.</summary>
    public static JsonObject BuildInputSchema(OperationConfig op)
    {
        var properties = new JsonObject();
        var required = new JsonArray();
        foreach (var p in op.Params ?? [])
        {
            properties[p.Name] = ParamSchema(p);
            if (p.Required == true || p.In == "path") required.Add(p.Name);
        }
        return new JsonObject
        {
            ["type"] = "object",
            ["additionalProperties"] = false,
            ["properties"] = properties,
            ["required"] = required,
        };
    }

    /// <summary>Generate all MCP tools from a resolved config.</summary>
    public static List<GeneratedTool> Generate(DrawbridgeConfig config)
    {
        var tools = new List<GeneratedTool>();
        foreach (var (key, platform) in config.Platforms)
            foreach (var op in Naming.GeneratedOps(platform))
                tools.Add(new GeneratedTool(Naming.ToolName(key, op), op.Description, BuildInputSchema(op), key, op));
        return tools;
    }
}
