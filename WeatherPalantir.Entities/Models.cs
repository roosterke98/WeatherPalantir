namespace WeatherPalantir.Entities;

public enum TimeGrain { Hour, Day, Month, Year, All }

public enum GeoLevel { Location, Region, Country, All }

public enum DataKind { All, Historical, Forecast }

/// <summary>
/// Egy OLAP-jellegű lekérdezés leírása: időbeli és térbeli részletességi szint (roll-up / drill-down),
/// valamint a dimenziók menti szűrések (slice / dice).
/// </summary>
public sealed class CubeQuery
{
    public DateTime From { get; set; }
    public DateTime To { get; set; }
    public TimeGrain Grain { get; set; } = TimeGrain.Day;
    public GeoLevel Level { get; set; } = GeoLevel.Region;
    public DataKind Kind { get; set; } = DataKind.All;
    public List<string> Measures { get; set; } = [];
    public List<int> LocationKeys { get; set; } = [];
    public List<int> RegionKeys { get; set; } = [];
    public List<string> CountryCodes { get; set; } = [];
    public List<int> ConditionKeys { get; set; } = [];
}

public sealed record CubeRow(
    DateTime? Period,
    string MemberKey,
    string MemberName,
    int LocationCount,
    int HourCount,
    Dictionary<string, double?> Values);

public sealed record CubeResult(
    TimeGrain Grain,
    GeoLevel Level,
    IReadOnlyList<string> Measures,
    IReadOnlyList<DateTime> Periods,
    IReadOnlyList<CubeRow> Rows);

public sealed record LocationDto(
    int LocationKey,
    string? Name,
    double Latitude,
    double Longitude,
    int? RegionKey,
    string? RegionName,
    string? CountryCode,
    string? CountryName,
    bool IsActive);

public sealed record RegionDto(int RegionKey, string CountryCode, string RegionName, string? CountryName);

public sealed record DataRangeDto(DateTime? Min, DateTime? Max, DateTime? HistoricalMax, DateTime? ForecastMin, DateTime? ForecastMax);

public sealed record WeatherConditionDto(int WeatherConditionKey, string Description, string Severity);

public sealed record ConditionCountDto(int? WeatherConditionKey, string Description, string? Severity, int Hours);

public sealed record WindRoseCellDto(int Sector, int SpeedBand, int Hours);

public sealed record ErrorLogDto(int LogId, DateTime? ExecutionDate, string? PackageName, string? ComponentName, string? ErrorMessage);

public sealed record NewLocationDto(
    int QueueId,
    double Latitude,
    double Longitude,
    string CountryCode,
    string? CityName,
    string Status,
    DateTime RequestDate,
    DateTime? FinishDate,
    string? ErrorMessage);

public sealed class NewLocationRequest
{
    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public string CountryCode { get; set; } = "";
    public string? CityName { get; set; }
}

/// <summary>Az Open-Meteo Geocoding API egy találata, kiegészítve az adattárház régió-illesztésével.</summary>
public sealed record GeocodingResultDto(
    long Id,
    string Name,
    double Latitude,
    double Longitude,
    string? CountryCode,
    string? Country,
    string? Admin1,
    string? Admin2,
    int? Population,
    double? Elevation,
    int? RegionKey,
    string? RegionName,
    bool Supported, // true, ha a pont egy már nyilvántartott régióba esik (különben új országot/régiót jelent)
    bool AlreadyTracked);
