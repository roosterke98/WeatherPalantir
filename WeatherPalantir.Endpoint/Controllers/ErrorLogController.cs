using Microsoft.AspNetCore.Mvc;
using WeatherPalantir.Data;
using WeatherPalantir.Entities;

namespace WeatherPalantir.Endpoint.Controllers;

/// <summary>Az ETL (SSIS) folyamat által a meta.ErrorLog táblába írt hibák lekérdezése.</summary>
[ApiController]
[Route("api/errorlog")]
public sealed class ErrorLogController(IMetaRepository meta) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<ErrorLogDto>>> Get(
        [FromQuery] DateTime? from, [FromQuery] DateTime? to, [FromQuery] string? package, [FromQuery] string? search,
        [FromQuery] int top = 500, CancellationToken ct = default) =>
        Ok(await meta.GetErrorLogAsync(from, to, package, search, top, ct));

    [HttpGet("packages")]
    public async Task<ActionResult<IReadOnlyList<string>>> Packages(CancellationToken ct) =>
        Ok(await meta.GetErrorPackagesAsync(ct));
}
