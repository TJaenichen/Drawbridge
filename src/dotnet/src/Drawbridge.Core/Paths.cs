namespace Drawbridge.Core;

public static class Paths
{
    /// <summary>
    /// Locate the config schema by walking up from the app base dir, mirroring the
    /// Node resolver: prefer the repo's specs/, fall back to a bundled schema/.
    /// </summary>
    public static string FindConfigSchema()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        for (var i = 0; i < 12 && dir is not null; i++)
        {
            var specs = Path.Combine(dir.FullName, "specs", "drawbridge.config.schema.json");
            if (File.Exists(specs)) return specs;
            var bundled = Path.Combine(dir.FullName, "schema", "drawbridge.config.schema.json");
            if (File.Exists(bundled)) return bundled;
            dir = dir.Parent;
        }
        throw new ConfigException("Could not locate drawbridge.config.schema.json");
    }
}
