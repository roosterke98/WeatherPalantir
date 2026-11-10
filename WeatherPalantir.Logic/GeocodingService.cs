using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using WeatherPalantir.Data;
using WeatherPalantir.Entities;

namespace WeatherPalantir.Logic;

public interface IGeocodingService
{
    Task<IReadOnlyList<GeocodingResultDto>> SearchAsync(string name, int count, string? countryCode, string language, CancellationToken ct);
}

/// <summary>
/// Az Open-Meteo Geocoding API (geocoding-api.open-meteo.com) hívása. A találatokat kiegészíti azzal,
/// hogy a pont az adattárház melyik régiójába (dm.DimRegion) esik. Ha egyikbe sem (új ország),
/// a helyszín ettől még felvehető – az ETL tölti be az új ország régióhatárait.
/// </summary>
public sealed class GeocodingService(HttpClient http, IDimensionRepository dimensions, IMetaRepository meta, ILogger<GeocodingService> logger)
    : IGeocodingService
{
    public async Task<IReadOnlyList<GeocodingResultDto>> SearchAsync(string name, int count, string? countryCode, string language, CancellationToken ct)
    {
        var url = $"v1/search?name={Uri.EscapeDataString(name)}&count={Math.Clamp(count, 1, 20)}&language={Uri.EscapeDataString(language)}&format=json";
        if (!string.IsNullOrWhiteSpace(countryCode)) url += $"&countryCode={Uri.EscapeDataString(countryCode)}";

        GeocodingResponse? response;
        try
        {
            response = await http.GetFromJsonAsync<GeocodingResponse>(url, ct);
        }
        catch (HttpRequestException ex)
        {
            logger.LogWarning(ex, "Open-Meteo geocoding hívás sikertelen: {Name}", name);
            throw new GeocodingUnavailableException("Az Open-Meteo Geocoding API jelenleg nem érhető el.", ex);
        }

        var results = new List<GeocodingResultDto>();
        foreach (var g in response?.Results ?? [])
        {
            var region = await dimensions.FindRegionAsync(g.Latitude, g.Longitude, ct);
            var tracked = await meta.IsLocationTrackedAsync(g.Latitude, g.Longitude, ct);
            results.Add(new GeocodingResultDto(
                g.Id, g.Name, g.Latitude, g.Longitude, g.CountryCode, g.Country, g.Admin1, g.Admin2,
                g.Population, g.Elevation, region?.RegionKey, region?.RegionName,
                Supported: region is not null, AlreadyTracked: tracked));
        }
        return results;
    }

    private sealed class GeocodingResponse
    {
        [JsonPropertyName("results")] public List<GeocodingItem>? Results { get; set; }
    }

    private sealed class GeocodingItem
    {
        [JsonPropertyName("id")] public long Id { get; set; }
        [JsonPropertyName("name")] public string Name { get; set; } = "";
        [JsonPropertyName("latitude")] public double Latitude { get; set; }
        [JsonPropertyName("longitude")] public double Longitude { get; set; }
        [JsonPropertyName("elevation")] public double? Elevation { get; set; }
        [JsonPropertyName("country_code")] public string? CountryCode { get; set; }
        [JsonPropertyName("country")] public string? Country { get; set; }
        [JsonPropertyName("admin1")] public string? Admin1 { get; set; }
        [JsonPropertyName("admin2")] public string? Admin2 { get; set; }
        [JsonPropertyName("population")] public int? Population { get; set; }
    }
}

public sealed class GeocodingUnavailableException(string message, Exception inner) : Exception(message, inner);
