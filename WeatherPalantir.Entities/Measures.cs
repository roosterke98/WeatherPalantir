namespace WeatherPalantir.Entities;

/// <summary>Hogyan aggregálható egy mérőszám az idő- és térbeli hierarchiák mentén.</summary>
public enum Aggregation
{
    /// <summary>Átlag (pl. hőmérséklet).</summary>
    Avg,
    /// <summary>Összeg időben, átlag helyszínek között (pl. csapadék).</summary>
    Sum,
    /// <summary>Maximum (pl. széllökés).</summary>
    Max,
    /// <summary>Vektoros (cirkuláris) átlag, szögértékekhez (szélirány).</summary>
    Vector
}

/// <param name="Key">API-ban használt azonosító (camelCase).</param>
/// <param name="Column">A dm.FactWeather oszlopa. Kizárólag ebből a fehérlistából kerül SQL-be.</param>
/// <param name="Chart">Optimális grafikontípus: line | bar | area | compass.</param>
/// <param name="MapEncodings">Térképes megjelenítés: fill (színskála) és/vagy glyph (irányvonal, buborék).</param>
/// <param name="ColorScheme">A frontend által használt színskála neve.</param>
public sealed record MeasureDefinition(
    string Key,
    string Column,
    string Label,
    string Unit,
    Aggregation Aggregation,
    string Chart,
    string[] MapEncodings,
    string ColorScheme,
    string Group,
    string? Expression = null)
{
    /// <summary>
    /// Az aggregálandó SQL kifejezés. Származtatott mérőszámnál (pl. vízmérleg) a kódban rögzített
    /// <see cref="Expression"/>, egyébként a ténytábla oszlopa.
    /// </summary>
    public string Sql => Expression ?? $"f.[{Column}]";
}

public static class Measures
{
    public static readonly IReadOnlyList<MeasureDefinition> All =
    [
        new("temperature", "Temperature", "Hőmérséklet", "°C", Aggregation.Avg, "line", ["fill"], "temperature", "Hőmérséklet"),
        new("apparentTemperature", "ApparentTemperature", "Érzett hőmérséklet", "°C", Aggregation.Avg, "line", ["fill"], "temperature", "Hőmérséklet"),
        new("dewPoint", "DewPoint", "Harmatpont", "°C", Aggregation.Avg, "line", ["fill"], "temperature", "Hőmérséklet"),
        new("precipitation", "Precipitation", "Csapadék", "mm", Aggregation.Sum, "bar", ["fill", "glyph"], "precipitation", "Csapadék"),
        new("rain", "Rain", "Eső", "mm", Aggregation.Sum, "bar", ["fill", "glyph"], "precipitation", "Csapadék"),
        new("snowfall", "Snowfall", "Hóesés", "cm", Aggregation.Sum, "bar", ["fill", "glyph"], "snow", "Csapadék"),
        new("precipitationProbability", "PrecipitationProbability", "Csapadék valószínűsége", "%", Aggregation.Avg, "area", ["fill"], "probability", "Csapadék"),
        new("windSpeed", "WindSpeed", "Szélsebesség", "km/h", Aggregation.Avg, "line", ["fill"], "wind", "Szél"),
        new("windGusts", "WindGusts", "Széllökés", "km/h", Aggregation.Max, "line", ["fill"], "wind", "Szél"),
        new("windDirection", "WindDirection", "Szélirány", "°", Aggregation.Vector, "compass", ["glyph"], "direction", "Szél"),
        new("shortwaveRadiation", "ShortwaveRadiation", "Globálsugárzás (GHI)", "W/m²", Aggregation.Avg, "area", ["fill"], "radiation", "Napsugárzás"),
        new("directNormalIrradiance", "DirectNormalIrradiance", "Direkt sugárzás (DNI)", "W/m²", Aggregation.Avg, "area", ["fill"], "radiation", "Napsugárzás"),
        new("diffuseHorizontalIrradiance", "DiffuseHorizontalIrradiance", "Szórt sugárzás (DHI)", "W/m²", Aggregation.Avg, "area", ["fill"], "radiation", "Napsugárzás"),
        new("relativeHumidity", "RelativeHumidity", "Relatív páratartalom", "%", Aggregation.Avg, "area", ["fill"], "humidity", "Légkör"),
        new("cloudCover", "CloudCover", "Felhőzet", "%", Aggregation.Avg, "area", ["fill"], "cloud", "Légkör"),
        new("visibility", "Visibility", "Látótávolság", "m", Aggregation.Avg, "line", ["fill"], "visibility", "Légkör"),
        new("surfacePressure", "SurfacePressure", "Felszíni légnyomás", "hPa", Aggregation.Avg, "line", ["fill"], "pressure", "Légkör"),
        new("vapourPressureDeficit", "VapourPressureDeficit", "Telítési hiány (VPD)", "kPa", Aggregation.Avg, "area", ["fill"], "vpd", "Vízmérleg"),
        new("evapotranspiration", "Evapotranspiration", "Referencia párolgás (ET₀)", "mm", Aggregation.Sum, "bar", ["fill"], "evapotranspiration", "Vízmérleg"),
        // Származtatott mérőszám: az óránkénti csapadék és referencia párolgás különbsége, időben összegezve.
        new("waterBalance", "Precipitation", "Vízmérleg (csapadék − ET₀)", "mm", Aggregation.Sum, "bar", ["fill"], "balance", "Vízmérleg",
            "f.[Precipitation] - f.[Evapotranspiration]"),
    ];

    private static readonly Dictionary<string, MeasureDefinition> ByKey =
        All.ToDictionary(m => m.Key, StringComparer.OrdinalIgnoreCase);

    public static bool TryGet(string key, out MeasureDefinition measure) => ByKey.TryGetValue(key, out measure!);
}
