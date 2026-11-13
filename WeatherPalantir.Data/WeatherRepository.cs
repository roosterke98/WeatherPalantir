using System.Text;
using Dapper;
using WeatherPalantir.Entities;

namespace WeatherPalantir.Data;

public interface IWeatherRepository
{
    Task<CubeResult> QueryCubeAsync(CubeQuery query, IReadOnlyList<MeasureDefinition> measures, CancellationToken ct);
    Task<IReadOnlyList<ConditionCountDto>> GetConditionCountsAsync(CubeQuery query, CancellationToken ct);
    Task<IReadOnlyList<ConditionSeriesRowDto>> GetConditionSeriesAsync(CubeQuery query, CancellationToken ct);
    Task<IReadOnlyList<WindRoseCellDto>> GetWindRoseAsync(CubeQuery query, CancellationToken ct);
    Task<DataRangeDto> GetDataRangeAsync(CancellationToken ct);
}

public sealed class WeatherRepository(IDbConnectionFactory db) : IWeatherRepository
{
    /// <summary>
    /// Kétlépcsős aggregálás: először helyszínenként és periódusonként (időbeli roll-up),
    /// majd a választott földrajzi szintre (térbeli roll-up). Így pl. a csapadék a perióduson belül
    /// összegződik, de a régió értéke a helyszínek átlaga lesz, nem az összege.
    /// </summary>
    public async Task<CubeResult> QueryCubeAsync(CubeQuery query, IReadOnlyList<MeasureDefinition> measures, CancellationToken ct)
    {
        var p = new DynamicParameters();
        var period = SqlFragments.PeriodExpr(query.Grain);
        var (memberKey, memberName) = SqlFragments.MemberExpr(query.Level);

        var inner = new StringBuilder();
        var outer = new StringBuilder();
        foreach (var m in measures)
        {
            var col = $"CAST(f.[{m.Column}] AS float)";
            switch (m.Aggregation)
            {
                case Aggregation.Avg:
                    inner.Append($", AVG({col}) AS [{m.Key}]");
                    outer.Append($", AVG(b.[{m.Key}]) AS [{m.Key}]");
                    break;
                case Aggregation.Sum:
                    // A NULL-t nem tekintjük 0-nak: ha egy periódusban nincs mérés, az összeg is NULL marad.
                    inner.Append($", SUM({col}) AS [{m.Key}]");
                    outer.Append($", AVG(b.[{m.Key}]) AS [{m.Key}]");
                    break;
                case Aggregation.Max:
                    inner.Append($", MAX({col}) AS [{m.Key}]");
                    outer.Append($", MAX(b.[{m.Key}]) AS [{m.Key}]");
                    break;
                case Aggregation.Vector:
                    inner.Append($", AVG(SIN(RADIANS({col}))) AS [{m.Key}__s], AVG(COS(RADIANS({col}))) AS [{m.Key}__c]");
                    outer.Append($", AVG(b.[{m.Key}__s]) AS [{m.Key}__s], AVG(b.[{m.Key}__c]) AS [{m.Key}__c]");
                    break;
            }
        }

        // Konstans kifejezés (Grain=All, Level=All) nem szerepelhet a GROUP BY-ban.
        var innerGroup = string.Join(", ", new[] { "f.LocationKey",
            query.Grain == TimeGrain.All ? null : period,
            query.Level == GeoLevel.All ? null : memberKey,
            query.Level == GeoLevel.All ? null : memberName }.Where(x => x is not null));
        var outerGroup = (query.Grain, query.Level) switch
        {
            (TimeGrain.All, GeoLevel.All) => "",
            (TimeGrain.All, _) => "GROUP BY b.MemberKey, b.MemberName",
            (_, GeoLevel.All) => "GROUP BY b.Period",
            _ => "GROUP BY b.Period, b.MemberKey, b.MemberName"
        };
        // Csoportosítás nélkül is egy sor jön vissza; a nem csoportosított oszlopokat MIN()-nel adjuk vissza.
        var outerSelect = query.Level == GeoLevel.All || query.Grain == TimeGrain.All
            ? "MIN(b.Period) AS Period, MIN(b.MemberKey) AS MemberKey, MIN(b.MemberName) AS MemberName"
            : "b.Period, b.MemberKey, b.MemberName";

        var sql = $"""
            WITH b AS (
                SELECT f.LocationKey,
                       {period} AS Period,
                       {memberKey} AS MemberKey,
                       {memberName} AS MemberName,
                       COUNT(*) AS N
                       {inner}
                {SqlFragments.StarJoin}
                {SqlFragments.Where(query, p)}
                GROUP BY {innerGroup}
            )
            SELECT {outerSelect},
                   COUNT(DISTINCT b.LocationKey) AS LocationCount, SUM(b.N) AS HourCount
                   {outer}
            FROM b
            {outerGroup}
            HAVING COUNT(*) > 0
            ORDER BY 1, 3;
            """;

        await using var conn = await db.OpenAsync(ct);
        var raw = await conn.QueryAsync(new CommandDefinition(sql, p, commandTimeout: 120, cancellationToken: ct));

        var rows = new List<CubeRow>();
        foreach (IDictionary<string, object?> r in raw)
        {
            var values = new Dictionary<string, double?>(measures.Count);
            foreach (var m in measures)
            {
                if (m.Aggregation == Aggregation.Vector)
                {
                    var s = r[$"{m.Key}__s"] as double?;
                    var c = r[$"{m.Key}__c"] as double?;
                    values[m.Key] = s is null || c is null || (Math.Abs(s.Value) < 1e-9 && Math.Abs(c.Value) < 1e-9)
                        ? null
                        : Math.Round((Math.Atan2(s.Value, c.Value) * 180 / Math.PI + 360) % 360, 1);
                }
                else
                {
                    values[m.Key] = r[m.Key] is double d ? Math.Round(d, 2) : null;
                }
            }

            rows.Add(new CubeRow(
                r["Period"] as DateTime?,
                (string)r["MemberKey"]!,
                (string)r["MemberName"]!,
                Convert.ToInt32(r["LocationCount"]),
                Convert.ToInt32(r["HourCount"]),
                values));
        }

        var periods = rows.Where(x => x.Period.HasValue).Select(x => x.Period!.Value).Distinct().Order().ToList();
        return new CubeResult(query.Grain, query.Level, measures.Select(m => m.Key).ToList(), periods, rows);
    }

    public async Task<IReadOnlyList<ConditionCountDto>> GetConditionCountsAsync(CubeQuery query, CancellationToken ct)
    {
        var p = new DynamicParameters();
        var sql = $"""
            SELECT f.WeatherConditionKey,
                   COALESCE(wc.[Description], N'Ismeretlen') AS [Description],
                   wc.Severity,
                   COUNT(*) AS Hours
            {SqlFragments.StarJoin}
            LEFT JOIN dm.DimWeatherCondition wc ON wc.WeatherConditionKey = f.WeatherConditionKey
            {SqlFragments.Where(query, p)}
            GROUP BY f.WeatherConditionKey, wc.[Description], wc.Severity
            ORDER BY Hours DESC;
            """;
        await using var conn = await db.OpenAsync(ct);
        var result = await conn.QueryAsync<ConditionCountDto>(new CommandDefinition(sql, p, commandTimeout: 120, cancellationToken: ct));
        return result.ToList();
    }

    /// <summary>
    /// Az időjárási viszonyok óraszáma periódusonként, a választott időbeli szinten. A súlyosság (Severity)
    /// szerinti felgöngyölítést a kliens végzi, így a lefúrás (súlyosság → viszony) nem igényel új lekérdezést.
    /// </summary>
    public async Task<IReadOnlyList<ConditionSeriesRowDto>> GetConditionSeriesAsync(CubeQuery query, CancellationToken ct)
    {
        var p = new DynamicParameters();
        var period = SqlFragments.PeriodExpr(query.Grain);
        var groupPeriod = query.Grain == TimeGrain.All ? "" : $"{period}, ";
        var sql = $"""
            SELECT {period} AS Period,
                   f.WeatherConditionKey,
                   COALESCE(wc.[Description], N'Ismeretlen') AS [Description],
                   wc.Severity,
                   COUNT(*) AS Hours
            {SqlFragments.StarJoin}
            LEFT JOIN dm.DimWeatherCondition wc ON wc.WeatherConditionKey = f.WeatherConditionKey
            {SqlFragments.Where(query, p)}
            GROUP BY {groupPeriod}f.WeatherConditionKey, wc.[Description], wc.Severity
            ORDER BY 1, 2;
            """;
        await using var conn = await db.OpenAsync(ct);
        var result = await conn.QueryAsync<ConditionSeriesRowDto>(new CommandDefinition(sql, p, commandTimeout: 120, cancellationToken: ct));
        return result.ToList();
    }

    /// <summary>Szélrózsa: 16 égtáj-szektor × szélsebesség-sáv gyakorisága (órák száma).</summary>
    public async Task<IReadOnlyList<WindRoseCellDto>> GetWindRoseAsync(CubeQuery query, CancellationToken ct)
    {
        var p = new DynamicParameters();
        var sql = $"""
            SELECT CAST(ROUND(f.WindDirection / 22.5, 0) AS int) % 16 AS Sector,
                   CASE WHEN f.WindSpeed < 5 THEN 0
                        WHEN f.WindSpeed < 15 THEN 1
                        WHEN f.WindSpeed < 25 THEN 2
                        WHEN f.WindSpeed < 40 THEN 3
                        ELSE 4 END AS SpeedBand,
                   COUNT(*) AS Hours
            {SqlFragments.StarJoin}
            {SqlFragments.Where(query, p)} AND f.WindDirection IS NOT NULL AND f.WindSpeed IS NOT NULL
            GROUP BY CAST(ROUND(f.WindDirection / 22.5, 0) AS int) % 16,
                     CASE WHEN f.WindSpeed < 5 THEN 0
                          WHEN f.WindSpeed < 15 THEN 1
                          WHEN f.WindSpeed < 25 THEN 2
                          WHEN f.WindSpeed < 40 THEN 3
                          ELSE 4 END;
            """;
        await using var conn = await db.OpenAsync(ct);
        var result = await conn.QueryAsync<WindRoseCellDto>(new CommandDefinition(sql, p, commandTimeout: 120, cancellationToken: ct));
        return result.ToList();
    }

    public async Task<DataRangeDto> GetDataRangeAsync(CancellationToken ct)
    {
        const string sql = """
            SELECT MIN(t.[Datetime]) AS [Min],
                   MAX(t.[Datetime]) AS [Max],
                   MAX(CASE WHEN f.IsForecast = 0 THEN t.[Datetime] END) AS HistoricalMax,
                   MIN(CASE WHEN f.IsForecast = 1 THEN t.[Datetime] END) AS ForecastMin,
                   MAX(CASE WHEN f.IsForecast = 1 THEN t.[Datetime] END) AS ForecastMax
            FROM dm.FactWeather f
            JOIN dm.DimTime t ON t.TimeKey = f.TimeKey;
            """;
        await using var conn = await db.OpenAsync(ct);
        return await conn.QuerySingleAsync<DataRangeDto>(new CommandDefinition(sql, cancellationToken: ct));
    }
}
