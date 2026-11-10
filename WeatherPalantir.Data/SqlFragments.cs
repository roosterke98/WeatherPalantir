using System.Text;
using Dapper;
using WeatherPalantir.Entities;

namespace WeatherPalantir.Data;

/// <summary>
/// A csillagséma lekérdezésekhez közös SQL részletek. Minden dinamikusan beillesztett szöveg
/// fehérlistából (enum vagy <see cref="Measures"/>) származik, a felhasználói értékek paraméterként kerülnek át.
/// </summary>
internal static class SqlFragments
{
    public const string StarJoin = """
        FROM dm.FactWeather f
        JOIN dm.DimTime t ON t.TimeKey = f.TimeKey
        JOIN dm.DimLocation l ON l.LocationKey = f.LocationKey
        LEFT JOIN dm.DimRegion r ON r.RegionKey = l.RegionKey
        LEFT JOIN meta.CountryDictionary cd ON cd.Alpha3Code = r.CountryCode
        """;

    public const string CountryNameExpr =
        "CASE r.CountryCode WHEN 'HUN' THEN N'Magyarország' WHEN 'AUT' THEN N'Ausztria' ELSE COALESCE(cd.CountryName, r.CountryCode) END";

    public static string PeriodExpr(TimeGrain grain) => grain switch
    {
        TimeGrain.Hour => "t.[Datetime]",
        TimeGrain.Day => "CAST(t.[Date] AS datetime)",
        TimeGrain.Month => "CAST(DATEFROMPARTS(t.[Year], t.[Month], 1) AS datetime)",
        TimeGrain.Year => "CAST(DATEFROMPARTS(t.[Year], 1, 1) AS datetime)",
        TimeGrain.All => "CAST(NULL AS datetime)",
        _ => throw new ArgumentOutOfRangeException(nameof(grain))
    };

    public static (string Key, string Name) MemberExpr(GeoLevel level) => level switch
    {
        GeoLevel.Location => ("CAST(l.LocationKey AS nvarchar(20))",
            "COALESCE(l.[Name], CONCAT(CAST(l.Latitude AS decimal(7,3)), N', ', CAST(l.Longitude AS decimal(7,3))))"),
        GeoLevel.Region => ("COALESCE(CAST(r.RegionKey AS nvarchar(20)), N'0')", "COALESCE(r.RegionName, N'Ismeretlen régió')"),
        GeoLevel.Country => ("COALESCE(CAST(r.CountryCode AS nvarchar(20)), N'?')", $"COALESCE({CountryNameExpr}, N'Ismeretlen ország')"),
        GeoLevel.All => ("N'ALL'", "N'Összes helyszín'"),
        _ => throw new ArgumentOutOfRangeException(nameof(level))
    };

    /// <summary>A szeletelés / kockázás szűrőfeltételei (WHERE).</summary>
    public static string Where(CubeQuery q, DynamicParameters p)
    {
        var sb = new StringBuilder("WHERE t.[Datetime] >= @From AND t.[Datetime] < @ToExclusive AND l.IsActive = 1");
        p.Add("From", q.From.Date);
        p.Add("ToExclusive", q.To.Date.AddDays(1));

        if (q.Kind == DataKind.Historical) sb.Append(" AND f.IsForecast = 0");
        if (q.Kind == DataKind.Forecast) sb.Append(" AND f.IsForecast = 1");

        if (q.LocationKeys.Count > 0) { sb.Append(" AND f.LocationKey IN @LocationKeys"); p.Add("LocationKeys", q.LocationKeys); }
        if (q.RegionKeys.Count > 0) { sb.Append(" AND l.RegionKey IN @RegionKeys"); p.Add("RegionKeys", q.RegionKeys); }
        if (q.CountryCodes.Count > 0) { sb.Append(" AND r.CountryCode IN @CountryCodes"); p.Add("CountryCodes", q.CountryCodes); }
        if (q.ConditionKeys.Count > 0) { sb.Append(" AND f.WeatherConditionKey IN @ConditionKeys"); p.Add("ConditionKeys", q.ConditionKeys); }

        return sb.ToString();
    }
}
