using Dapper;
using WeatherPalantir.Entities;

namespace WeatherPalantir.Data;

public interface IDimensionRepository
{
    Task<IReadOnlyList<LocationDto>> GetLocationsAsync(CancellationToken ct);
    Task<IReadOnlyList<RegionDto>> GetRegionsAsync(CancellationToken ct);
    /// <summary>Országonként a régiók aktuális állapotának olcsón számolható lenyomata (a határok beolvasása nélkül).</summary>
    Task<IReadOnlyList<(string CountryCode, string Version)>> GetRegionVersionsAsync(CancellationToken ct);
    Task<IReadOnlyList<(RegionDto Region, string Wkt)>> GetRegionBoundariesAsync(string countryCode, double reduceMeters, CancellationToken ct);
    Task<IReadOnlyList<WeatherConditionDto>> GetWeatherConditionsAsync(CancellationToken ct);
    /// <summary>Megkeresi azt a régiót (megye / tartomány), amelynek határán belül a pont esik.</summary>
    Task<RegionDto?> FindRegionAsync(double latitude, double longitude, CancellationToken ct);
}

public sealed class DimensionRepository(IDbConnectionFactory db) : IDimensionRepository
{
    public async Task<IReadOnlyList<LocationDto>> GetLocationsAsync(CancellationToken ct)
    {
        var sql = $"""
            SELECT l.LocationKey, l.[Name],
                   CAST(l.Latitude AS float) AS Latitude, CAST(l.Longitude AS float) AS Longitude,
                   l.RegionKey, r.RegionName, CAST(r.CountryCode AS nvarchar(3)) AS CountryCode,
                   {SqlFragments.CountryNameExpr} AS CountryName,
                   l.IsActive
            FROM dm.DimLocation l
            LEFT JOIN dm.DimRegion r ON r.RegionKey = l.RegionKey
            LEFT JOIN meta.CountryDictionary cd ON cd.Alpha3Code = r.CountryCode
            ORDER BY l.[Name];
            """;
        await using var conn = await db.OpenAsync(ct);
        return (await conn.QueryAsync<LocationDto>(new CommandDefinition(sql, cancellationToken: ct))).ToList();
    }

    public async Task<IReadOnlyList<RegionDto>> GetRegionsAsync(CancellationToken ct)
    {
        var sql = $"""
            SELECT r.RegionKey, CAST(r.CountryCode AS nvarchar(3)) AS CountryCode, r.RegionName, {SqlFragments.CountryNameExpr} AS CountryName
            FROM dm.DimRegion r
            LEFT JOIN meta.CountryDictionary cd ON cd.Alpha3Code = r.CountryCode
            ORDER BY r.CountryCode, r.RegionName;
            """;
        await using var conn = await db.OpenAsync(ct);
        return (await conn.QueryAsync<RegionDto>(new CommandDefinition(sql, cancellationToken: ct))).ToList();
    }

    public async Task<IReadOnlyList<(string CountryCode, string Version)>> GetRegionVersionsAsync(CancellationToken ct)
    {
        const string sql = """
            SELECT CAST(r.CountryCode AS nvarchar(3)) AS CountryCode, COUNT(*) AS Regions, MAX(r.RegionKey) AS MaxKey,
                   CHECKSUM_AGG(CHECKSUM(r.RegionKey, r.RegionName)) AS NameSum
            FROM dm.DimRegion r
            WHERE r.CountryCode IS NOT NULL
            GROUP BY r.CountryCode
            ORDER BY r.CountryCode;
            """;
        await using var conn = await db.OpenAsync(ct);
        var rows = await conn.QueryAsync(new CommandDefinition(sql, cancellationToken: ct));
        return rows.Cast<IDictionary<string, object?>>()
            .Select(r => ((string)r["CountryCode"]!, $"{r["Regions"]}-{r["MaxKey"]}-{r["NameSum"]}"))
            .ToList();
    }

    public async Task<IReadOnlyList<(RegionDto Region, string Wkt)>> GetRegionBoundariesAsync(string countryCode, double reduceMeters, CancellationToken ct)
    {
        var sql = $"""
            SELECT r.RegionKey, CAST(r.CountryCode AS nvarchar(3)) AS CountryCode, r.RegionName, {SqlFragments.CountryNameExpr} AS CountryName,
                   CASE WHEN @Reduce > 0 THEN r.Boundary.Reduce(@Reduce).STAsText() ELSE r.Boundary.STAsText() END AS Wkt
            FROM dm.DimRegion r
            LEFT JOIN meta.CountryDictionary cd ON cd.Alpha3Code = r.CountryCode
            WHERE r.CountryCode = @CountryCode
            ORDER BY r.RegionKey;
            """;
        await using var conn = await db.OpenAsync(ct);
        var rows = await conn.QueryAsync(new CommandDefinition(sql, new { Reduce = reduceMeters, CountryCode = countryCode }, commandTimeout: 120, cancellationToken: ct));
        return rows.Cast<IDictionary<string, object?>>()
            .Select(r => (new RegionDto((int)r["RegionKey"]!, (string)r["CountryCode"]!, (string)r["RegionName"]!, r["CountryName"] as string),
                          (string)r["Wkt"]!))
            .ToList();
    }

    public async Task<IReadOnlyList<WeatherConditionDto>> GetWeatherConditionsAsync(CancellationToken ct)
    {
        const string sql = "SELECT WeatherConditionKey, [Description], Severity FROM dm.DimWeatherCondition ORDER BY WeatherConditionKey;";
        await using var conn = await db.OpenAsync(ct);
        return (await conn.QueryAsync<WeatherConditionDto>(new CommandDefinition(sql, cancellationToken: ct))).ToList();
    }

    public async Task<RegionDto?> FindRegionAsync(double latitude, double longitude, CancellationToken ct)
    {
        var sql = $"""
            SELECT TOP 1 r.RegionKey, CAST(r.CountryCode AS nvarchar(3)) AS CountryCode, r.RegionName, {SqlFragments.CountryNameExpr} AS CountryName
            FROM dm.DimRegion r
            LEFT JOIN meta.CountryDictionary cd ON cd.Alpha3Code = r.CountryCode
            WHERE r.Boundary.STIntersects(geography::Point(@Lat, @Lon, 4326)) = 1;
            """;
        await using var conn = await db.OpenAsync(ct);
        return await conn.QueryFirstOrDefaultAsync<RegionDto>(new CommandDefinition(sql, new { Lat = latitude, Lon = longitude }, cancellationToken: ct));
    }
}
