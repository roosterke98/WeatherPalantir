using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using WeatherPalantir.Data;

namespace WeatherPalantir.Logic;

public interface IRegionGeoJsonService
{
    /// <summary>A megadott országok régióhatárai; üres lista esetén az összes országé.</summary>
    Task<object> GetFeatureCollectionAsync(IReadOnlyCollection<string> countries, CancellationToken ct);
}

/// <summary>
/// A dm.DimRegion geography határaiból GeoJSON FeatureCollection-t állít elő a térképhez, országonként.
/// Egy ország határai memóriában gyorsítótárazódnak; a kulcs része az ország régióinak aktuális állapota
/// (darabszám, legnagyobb kulcs, nevek ellenőrző összege), így az ETL által utólag betöltött vagy módosított
/// ország a következő kérésnél újraindítás nélkül megjelenik.
/// </summary>
public sealed class RegionGeoJsonService(IDimensionRepository dimensions, IMemoryCache cache, IConfiguration config) : IRegionGeoJsonService
{
    public async Task<object> GetFeatureCollectionAsync(IReadOnlyCollection<string> countries, CancellationToken ct)
    {
        var versions = await dimensions.GetRegionVersionsAsync(ct);
        var wanted = countries.Count == 0
            ? versions
            : versions.Where(v => countries.Contains(v.CountryCode, StringComparer.OrdinalIgnoreCase)).ToList();

        var features = new List<object>();
        foreach (var (countryCode, version) in wanted)
            features.AddRange(await GetCountryFeaturesAsync(countryCode, version, ct));

        return new { type = "FeatureCollection", features };
    }

    private async Task<IReadOnlyList<object>> GetCountryFeaturesAsync(string countryCode, string version, CancellationToken ct)
    {
        var key = $"regions-geojson:{countryCode}:{version}";
        if (cache.TryGetValue(key, out IReadOnlyList<object>? cached) && cached is not null) return cached;

        // Egyes országok határai rendkívül részletesek (régiónként több tízezer pont), ezért egyszerűsítjük őket.
        var reduceMeters = config.GetValue("Map:BoundaryReduceMeters", 250.0);
        var regions = await dimensions.GetRegionBoundariesAsync(countryCode, reduceMeters, ct);

        IReadOnlyList<object> features = regions.Select(x => (object)new
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

        // A régi állapotok kulcsai maguktól kiöregednek.
        cache.Set(key, features, new MemoryCacheEntryOptions { SlidingExpiration = TimeSpan.FromHours(6) });
        return features;
    }
}
