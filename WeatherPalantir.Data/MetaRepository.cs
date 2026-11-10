using Dapper;
using WeatherPalantir.Entities;

namespace WeatherPalantir.Data;

public interface IMetaRepository
{
    Task<IReadOnlyList<ErrorLogDto>> GetErrorLogAsync(DateTime? from, DateTime? to, string? package, string? search, int top, CancellationToken ct);
    Task<IReadOnlyList<string>> GetErrorPackagesAsync(CancellationToken ct);
    Task<IReadOnlyList<NewLocationDto>> GetNewLocationsAsync(CancellationToken ct);
    Task<bool> IsLocationTrackedAsync(double latitude, double longitude, CancellationToken ct);
    Task<NewLocationDto> InsertNewLocationAsync(NewLocationRequest request, CancellationToken ct);
}

public sealed class MetaRepository(IDbConnectionFactory db) : IMetaRepository
{
    /// <summary>Két koordináta azonosnak tekintendő, ha ~100 m-en belül vannak.</summary>
    private const double SameLocationTolerance = 0.001;

    public async Task<IReadOnlyList<ErrorLogDto>> GetErrorLogAsync(DateTime? from, DateTime? to, string? package, string? search, int top, CancellationToken ct)
    {
        const string sql = """
            SELECT TOP (@Top) LogId, ExecutionDate, PackageName, ComponentName, ErrorMessage
            FROM meta.ErrorLog
            WHERE (@From IS NULL OR ExecutionDate >= @From)
              AND (@ToExclusive IS NULL OR ExecutionDate < @ToExclusive)
              AND (@Package IS NULL OR PackageName = @Package)
              AND (@Search IS NULL OR ErrorMessage LIKE @Search OR ComponentName LIKE @Search OR PackageName LIKE @Search)
            ORDER BY ExecutionDate DESC, LogId DESC;
            """;
        await using var conn = await db.OpenAsync(ct);
        var rows = await conn.QueryAsync<ErrorLogDto>(new CommandDefinition(sql, new
        {
            Top = Math.Clamp(top, 1, 5000),
            From = from?.Date,
            ToExclusive = to?.Date.AddDays(1),
            Package = string.IsNullOrWhiteSpace(package) ? null : package,
            Search = string.IsNullOrWhiteSpace(search) ? null : $"%{search.Replace("[", "[[]").Replace("%", "[%]").Replace("_", "[_]")}%"
        }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<IReadOnlyList<string>> GetErrorPackagesAsync(CancellationToken ct)
    {
        const string sql = "SELECT DISTINCT PackageName FROM meta.ErrorLog WHERE PackageName IS NOT NULL ORDER BY PackageName;";
        await using var conn = await db.OpenAsync(ct);
        return (await conn.QueryAsync<string>(new CommandDefinition(sql, cancellationToken: ct))).ToList();
    }

    public async Task<IReadOnlyList<NewLocationDto>> GetNewLocationsAsync(CancellationToken ct)
    {
        const string sql = """
            SELECT QueueId, CAST(Latitude AS float) AS Latitude, CAST(Longitude AS float) AS Longitude,
                   CountryCode, CityName, [Status], RequestDate, FinishDate, ErrorMessage
            FROM meta.NewLocation
            ORDER BY RequestDate DESC, QueueId DESC;
            """;
        await using var conn = await db.OpenAsync(ct);
        return (await conn.QueryAsync<NewLocationDto>(new CommandDefinition(sql, cancellationToken: ct))).ToList();
    }

    /// <summary>Szerepel-e már a helyszín a dimenzióban, vagy vár-e már feldolgozásra a sorban.</summary>
    public async Task<bool> IsLocationTrackedAsync(double latitude, double longitude, CancellationToken ct)
    {
        const string sql = """
            SELECT CASE WHEN EXISTS (
                SELECT 1 FROM dm.DimLocation
                WHERE ABS(CAST(Latitude AS float) - @Lat) < @Tol AND ABS(CAST(Longitude AS float) - @Lon) < @Tol
            ) OR EXISTS (
                SELECT 1 FROM meta.NewLocation
                WHERE [Status] NOT IN (N'Failed', N'Error')
                  AND ABS(CAST(Latitude AS float) - @Lat) < @Tol AND ABS(CAST(Longitude AS float) - @Lon) < @Tol
            ) THEN 1 ELSE 0 END;
            """;
        await using var conn = await db.OpenAsync(ct);
        return await conn.ExecuteScalarAsync<int>(new CommandDefinition(sql,
            new { Lat = latitude, Lon = longitude, Tol = SameLocationTolerance }, cancellationToken: ct)) == 1;
    }

    public async Task<NewLocationDto> InsertNewLocationAsync(NewLocationRequest request, CancellationToken ct)
    {
        // A Status és RequestDate oszlopok alapértéke ('Pending', GETDATE()) az adatbázisban van definiálva.
        const string sql = """
            INSERT INTO meta.NewLocation (Latitude, Longitude, CountryCode, CityName)
            OUTPUT inserted.QueueId, CAST(inserted.Latitude AS float) AS Latitude, CAST(inserted.Longitude AS float) AS Longitude,
                   inserted.CountryCode, inserted.CityName, inserted.[Status], inserted.RequestDate, inserted.FinishDate, inserted.ErrorMessage
            VALUES (@Latitude, @Longitude, @CountryCode, @CityName);
            """;
        await using var conn = await db.OpenAsync(ct);
        return await conn.QuerySingleAsync<NewLocationDto>(new CommandDefinition(sql, new
        {
            Latitude = Math.Round((decimal)request.Latitude, 6),
            Longitude = Math.Round((decimal)request.Longitude, 6),
            CountryCode = request.CountryCode.Trim().ToUpperInvariant(),
            CityName = string.IsNullOrWhiteSpace(request.CityName) ? null : request.CityName.Trim()
        }, cancellationToken: ct));
    }
}
