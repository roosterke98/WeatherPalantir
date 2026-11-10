using Microsoft.AspNetCore.Mvc;
using WeatherPalantir.Data;
using WeatherPalantir.Entities;
using WeatherPalantir.Logic;

namespace WeatherPalantir.Endpoint.Controllers;

/// <summary>
/// Új helyszínek felvétele: a frontend keresőjében kiválasztott települések a meta.NewLocation sorba kerülnek,
/// ahonnan az ETL folyamat tölti be őket az adattárházba.
/// </summary>
[ApiController]
[Route("api")]
public sealed class NewLocationsController(IMetaRepository meta, IGeocodingService geocoding) : ControllerBase
{
    /// <summary>Typeahead keresés az Open-Meteo Geocoding API-n keresztül.</summary>
    [HttpGet("geocoding/search")]
    public async Task<ActionResult<IReadOnlyList<GeocodingResultDto>>> Search(
        [FromQuery] string name, [FromQuery] int count = 10, [FromQuery] string? countryCode = null,
        [FromQuery] string language = "hu", CancellationToken ct = default)
    {
        // Az Open-Meteo 1 karakteres keresésre üres listát ad, 2 karakternél pedig csak pontos egyezést.
        if (string.IsNullOrWhiteSpace(name) || name.Trim().Length < 2) return Ok(Array.Empty<GeocodingResultDto>());
        try
        {
            return Ok(await geocoding.SearchAsync(name.Trim(), count, countryCode, language, ct));
        }
        catch (GeocodingUnavailableException ex)
        {
            return Problem(title: "Geocoding hiba", detail: ex.Message, statusCode: StatusCodes.Status502BadGateway);
        }
    }

    [HttpGet("newlocations")]
    public async Task<ActionResult<IReadOnlyList<NewLocationDto>>> List(CancellationToken ct) =>
        Ok(await meta.GetNewLocationsAsync(ct));

    [HttpPost("newlocations")]
    public async Task<ActionResult<NewLocationDto>> Create([FromBody] NewLocationRequest request, CancellationToken ct)
    {
        if (request.Latitude is < -90 or > 90 || request.Longitude is < -180 or > 180)
            return Problem(title: "Érvénytelen koordináta", detail: "A szélesség −90 és 90, a hosszúság −180 és 180 közé kell essen.", statusCode: 400);
        if (string.IsNullOrWhiteSpace(request.CountryCode) || request.CountryCode.Trim().Length > 20)
            return Problem(title: "Érvénytelen országkód", detail: "Az országkód megadása kötelező.", statusCode: 400);
        if (request.CityName?.Length > 200)
            return Problem(title: "Túl hosszú név", detail: "A település neve legfeljebb 200 karakter lehet.", statusCode: 400);

        // Bármely ország helyszíne felvehető: ha az ország még nem szerepel az adattárházban,
        // az ETL a helyszínnel együtt betölti az ország régióinak (megyéinek) határait is.
        if (await meta.IsLocationTrackedAsync(request.Latitude, request.Longitude, ct))
            return Problem(title: "Már szerepel", detail: "Ez a helyszín már szerepel az adattárházban vagy feldolgozásra vár.", statusCode: 409);

        var created = await meta.InsertNewLocationAsync(request, ct);
        return CreatedAtAction(nameof(List), null, created);
    }
}
