using System.Text.Json;
using System.Text.Json.Nodes;

namespace Drawbridge.Core;

/// <summary>Structural/semantic JSON equality (DESIGN §13): objects compared
/// key-order-independent, arrays order-sensitive, values by kind + value.</summary>
public static class JsonEqual
{
    public static bool DeepEquals(JsonNode? a, JsonNode? b)
    {
        if (a is null || b is null) return a is null && b is null;
        if (a is JsonObject oa && b is JsonObject ob)
        {
            if (oa.Count != ob.Count) return false;
            foreach (var (k, v) in oa)
            {
                if (!ob.TryGetPropertyValue(k, out var bv)) return false;
                if (!DeepEquals(v, bv)) return false;
            }
            return true;
        }
        if (a is JsonArray aa && b is JsonArray ab)
        {
            if (aa.Count != ab.Count) return false;
            for (var i = 0; i < aa.Count; i++)
                if (!DeepEquals(aa[i], ab[i])) return false;
            return true;
        }
        if (a is JsonValue && b is JsonValue)
        {
            var ka = a.GetValueKind();
            var kb = b.GetValueKind();
            if (ka != kb) return false;
            return ka switch
            {
                JsonValueKind.Number => double.TryParse(a.ToJsonString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var da)
                    && double.TryParse(b.ToJsonString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var db) && da == db,
                JsonValueKind.String => a.GetValue<string>() == b.GetValue<string>(),
                _ => true, // true/false/null already matched by kind
            };
        }
        return false;
    }
}
