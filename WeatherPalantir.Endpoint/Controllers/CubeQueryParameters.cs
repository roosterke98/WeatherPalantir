using WeatherPalantir.Entities;

namespace WeatherPalantir.Endpoint.Controllers;

/// <summary>
/// Query string paraméterek az elemző végpontokhoz. A listák vesszővel elválasztva érkeznek
/// (pl. <c>measures=temperature,precipitation&amp;regions=1,3</c>).
/// </summary>
public sealed class CubeQueryParameters
{
    /// <summary>Óra szintű bontás esetén ennél hosszabb időszak nem kérhető le.</summary>
    public const int MaxHourlyDays = 93;

    public DateTime? From { get; set; }
    public DateTime? To { get; set; }
    public TimeGrain Grain { get; set; } = TimeGrain.Day;
    public GeoLevel Level { get; set; } = GeoLevel.Region;
    public DataKind Kind { get; set; } = DataKind.All;
    public string? Measures { get; set; }
    public string? Locations { get; set; }
    public string? Regions { get; set; }
    public string? Countries { get; set; }
    public string? Conditions { get; set; }

    public bool TryBuild(bool requireMeasures, out CubeQuery query, out List<MeasureDefinition> measures, out string? error)
    {
        query = new CubeQuery();
        measures = [];
        error = null;

        if (From is null || To is null) { error = "A 'from' és 'to' paraméter megadása kötelező."; return false; }
        if (From > To) { error = "A kezdő dátum nem lehet későbbi a záró dátumnál."; return false; }
        if (Grain == TimeGrain.Hour && (To.Value.Date - From.Value.Date).TotalDays + 1 > MaxHourlyDays)
        {
            error = $"Órás bontás legfeljebb {MaxHourlyDays} napos időszakra kérhető.";
            return false;
        }

        foreach (var key in Split(Measures))
        {
            if (!Entities.Measures.TryGet(key, out var m)) { error = $"Ismeretlen paraméter: '{key}'."; return false; }
            if (!measures.Contains(m)) measures.Add(m);
        }
        if (requireMeasures && measures.Count == 0) { error = "Legalább egy paramétert (measures) meg kell adni."; return false; }

        if (!TryInts(Locations, out var locations) || !TryInts(Regions, out var regions) || !TryInts(Conditions, out var conditions))
        {
            error = "A helyszín, régió és időjárási viszony azonosítóknak egész számoknak kell lenniük.";
            return false;
        }

        query = new CubeQuery
        {
            From = From.Value,
            To = To.Value,
            Grain = Grain,
            Level = Level,
            Kind = Kind,
            Measures = measures.Select(m => m.Key).ToList(),
            LocationKeys = locations,
            RegionKeys = regions,
            CountryCodes = Split(Countries).Select(c => c.ToUpperInvariant()).ToList(),
            ConditionKeys = conditions
        };
        return true;
    }

    private static IEnumerable<string> Split(string? csv) =>
        (csv ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    private static bool TryInts(string? csv, out List<int> values)
    {
        values = [];
        foreach (var s in Split(csv))
        {
            if (!int.TryParse(s, out var v)) return false;
            values.Add(v);
        }
        return true;
    }
}
