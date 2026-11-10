using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using WeatherPalantir.Data;

namespace WeatherPalantir.Logic;

public interface IRegionGeoJsonService
{
    Task<object> GetFeatureCollectionAsync(CancellationToken ct);
}

/// <summary>
/// A dm.DimRegion geography határaiból GeoJSON FeatureCollection-t állít elő a térképhez.
/// A határok ritkán változnak, ezért az eredmény memóriában gyorsítótárazódik.
/// </summary>
public sealed class RegionGeoJsonService(IDimensionRepository dimensions, IMemoryCache cache, IConfiguration config) : IRegionGeoJsonService
{
    private const string CacheKey = "regions-geojson";

    public async Task<object> GetFeatureCollectionAsync(CancellationToken ct)
    {
        if (cache.TryGetValue(CacheKey, out object? cached) && cached is not null) return cached;

        // Az osztrák tartományok határai rendkívül részletesek (több tízezer pont), ezért egyszerűsítjük őket.
        var reduceMeters = config.GetValue("Map:BoundaryReduceMeters", 250.0);
        var regions = await dimensions.GetRegionBoundariesAsync(reduceMeters, ct);

        var features = regions.Select(x => new
        {
            type = "Feature",
            id = x.Region.RegionKey,
            properties = new
            {
                regionKey = x.Region.RegionKey,
                regionName = x.Region.RegionName,
                countryCode = x.Region.CountryCode,
                countryName = x.Region.CountryName
            },
            geometry = new { type = "MultiPolygon", coordinates = WktGeoJson.ToMultiPolygon(x.Wkt) }
        }).ToList();

        object result = new { type = "FeatureCollection", features };
        cache.Set(CacheKey, result, TimeSpan.FromHours(6));
        return result;
    }
}
