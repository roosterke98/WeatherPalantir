using Microsoft.AspNetCore.Mvc;
using WeatherPalantir.Data;
using WeatherPalantir.Entities;

namespace WeatherPalantir.Endpoint.Controllers;

/// <summary>Az adattárház (dm séma) elemző lekérdezései.</summary>
[ApiController]
[Route("api/weather")]
public sealed class WeatherController(IWeatherRepository repository) : ControllerBase
{
    /// <summary>
    /// OLAP kocka lekérdezés: a megadott idő- (grain) és földrajzi (level) szintre aggregált mérőszámok,
    /// a szűrők (slice/dice) figyelembevételével.
    /// </summary>
    [HttpGet("cube")]
    public async Task<ActionResult<CubeResult>> Cube([FromQuery] CubeQueryParameters parameters, CancellationToken ct)
    {
        if (!parameters.TryBuild(requireMeasures: true, out var query, out var measures, out var error))
            return ValidationProblem(error!);
        return Ok(await repository.QueryCubeAsync(query, measures, ct));
    }

    /// <summary>Időjárási viszonyok (WMO kód) gyakorisága órákban a kiválasztott szeletben.</summary>
    [HttpGet("conditions")]
    public async Task<ActionResult<IReadOnlyList<ConditionCountDto>>> Conditions([FromQuery] CubeQueryParameters parameters, CancellationToken ct)
    {
        if (!parameters.TryBuild(requireMeasures: false, out var query, out _, out var error))
            return ValidationProblem(error!);
        return Ok(await repository.GetConditionCountsAsync(query, ct));
    }

    /// <summary>Az időjárási viszonyok óraszáma periódusonként (grain), a súlyosság szerinti csoportosításhoz is.</summary>
    [HttpGet("conditions/series")]
    public async Task<ActionResult<IReadOnlyList<ConditionSeriesRowDto>>> ConditionSeries([FromQuery] CubeQueryParameters parameters, CancellationToken ct)
    {
        if (!parameters.TryBuild(requireMeasures: false, out var query, out _, out var error))
            return ValidationProblem(error!);
        return Ok(await repository.GetConditionSeriesAsync(query, ct));
    }

    /// <summary>Szélrózsa adatai: 16 szektor × 5 sebességsáv (0–5, 5–15, 15–25, 25–40, 40+ km/h).</summary>
    [HttpGet("windrose")]
    public async Task<ActionResult<IReadOnlyList<WindRoseCellDto>>> WindRose([FromQuery] CubeQueryParameters parameters, CancellationToken ct)
    {
        if (!parameters.TryBuild(requireMeasures: false, out var query, out _, out var error))
            return ValidationProblem(error!);
        return Ok(await repository.GetWindRoseAsync(query, ct));
    }

    [HttpGet("range")]
    public async Task<ActionResult<DataRangeDto>> Range(CancellationToken ct) => Ok(await repository.GetDataRangeAsync(ct));

    private ActionResult ValidationProblem(string message) =>
        Problem(title: "Érvénytelen lekérdezés", detail: message, statusCode: StatusCodes.Status400BadRequest);
}
