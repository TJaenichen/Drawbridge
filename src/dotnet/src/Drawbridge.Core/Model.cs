using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Drawbridge.Core;

// Config model — mirrors specs/drawbridge.config.schema.json (the source of truth).
// JSON keys are snake_case; deserialization uses JsonNamingPolicy.SnakeCaseLower.

public sealed record ParamItems(string Type, string[]? Enum);

public sealed record ParamConfig(
    string Name,
    string In,
    string Type,
    bool? Required,
    string? Description,
    string[]? Enum,
    JsonNode? Default,
    ParamItems? Items);

public sealed record OperationConfig(
    string Name,
    string Description,
    string Method,
    [property: JsonPropertyName("timeout_ms")] int? TimeoutMs,
    string Path,
    List<ParamConfig>? Params,
    [property: JsonPropertyName("max_response_bytes")] int? MaxResponseBytes);

public sealed record AuthConfig(
    string Type,
    string? SecretEnv,
    string? Name,
    string? UsernameEnv,
    string? PasswordEnv);

public sealed record Defaults([property: JsonPropertyName("timeout_ms")] int? TimeoutMs);

public sealed record PlatformConfig(
    string BaseUrl,
    [property: JsonPropertyName("timeout_ms")] int? TimeoutMs,
    bool? ReadOnly,
    AuthConfig Auth,
    List<OperationConfig> Operations);

public sealed record DrawbridgeConfig(
    int Version,
    Defaults? Defaults,
    Dictionary<string, PlatformConfig> Platforms);

/// <summary>A generated MCP tool. InputSchema is JSON Schema (Draft 2020-12 compatible).</summary>
public sealed record GeneratedTool(
    string Name,
    string Description,
    JsonObject InputSchema,
    string PlatformKey,
    OperationConfig Operation);

public static class Defaultss
{
    public const int TimeoutMs = 30000;
    public const int MaxResponseBytes = 1048576;
}

/// <summary>Thrown for any invalid configuration (fail-fast at startup).</summary>
public sealed class ConfigException(string message) : Exception(message);

public static class Naming
{
    /// <summary>Tool name for a generated operation: {platform}_{operation}.</summary>
    public static string ToolName(string platformKey, OperationConfig op) => $"{platformKey}_{op.Name}";

    /// <summary>Operations that become tools for a platform (read_only omits non-GET).</summary>
    public static IEnumerable<OperationConfig> GeneratedOps(PlatformConfig platform) =>
        platform.ReadOnly == true ? platform.Operations.Where(o => o.Method == "GET") : platform.Operations;
}
