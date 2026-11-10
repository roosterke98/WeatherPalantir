using Microsoft.AspNetCore.Mvc;
using WeatherPalantir.Data;
using WeatherPalantir.Entities;
using WeatherPalantir.Logic;

namespace WeatherPalantir.Endpoint.Controllers;

/// <summary>A dimenziótáblák és a paraméter-metaadatok lekérdezése.</summary>
[ApiController]
[Route("api")]
public sealed class DimensionsController(IDimensionRepository dimensions, IRegionGeoJsonService geoJson) : ControllerBase
{
    /// <summary>Az elemezhető időjárási paraméterek, aggregálási módjuk és javasolt megjelenítésük.</summary>
    [HttpGet("measures")]
    public ActionResult<IEnumerable<object>> GetMeasures() => Ok(Measures.All.Select(m => new
    {
        m.Key,
        m.Label,
        m.Unit,
        Aggregation = m.Aggregation.ToString().ToLowerInvariant(),
        m.Chart,
        m.MapEncodings,
        m.ColorScheme,
        m.Group
    }));

    [HttpGet("locations")]
    public async Task<ActionResult<IReadOnlyList<LocationDto>>> GetLocations(CancellationToken ct) =>
        Ok(await dimensions.GetLocationsAsync(ct));

    [HttpGet("regions")]
    public async Task<ActionResult<IReadOnlyList<RegionDto>>> GetRegions(CancellationToken ct) =>
        Ok(await dimensions.GetRegionsAsync(ct));

    /// <summary>A régiók (megyék, tartományok) határai GeoJSON formátumban a térképes megjelenítéshez.</summary>
    [HttpGet("regions/geojson")]
    [ResponseCache(Duration = 3600)]
    public async Task<IActionResult> GetRegionGeoJson(CancellationToken ct) => Ok(await geoJson.GetFeatureCollectionAsync(ct));

    [HttpGet("conditions")]
    public async Task<ActionResult<IReadOnlyList<WeatherConditionDto>>> GetConditions(CancellationToken ct) =>
        Ok(await dimensions.GetWeatherConditionsAsync(ct));
}
