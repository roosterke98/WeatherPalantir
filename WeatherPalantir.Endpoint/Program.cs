using System.Text.Json;
using System.Text.Json.Serialization;
using WeatherPalantir.Data;
using WeatherPalantir.Logic;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers().AddJsonOptions(o =>
{
    o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
});
builder.Services.AddOpenApi();
builder.Services.AddProblemDetails();
builder.Services.AddMemoryCache();

// Adatelérési réteg
builder.Services.AddSingleton<IDbConnectionFactory, SqlConnectionFactory>();
builder.Services.AddScoped<IWeatherRepository, WeatherRepository>();
builder.Services.AddScoped<IDimensionRepository, DimensionRepository>();
builder.Services.AddScoped<IMetaRepository, MetaRepository>();

// Szolgáltatási réteg
builder.Services.AddScoped<IRegionGeoJsonService, RegionGeoJsonService>();
builder.Services.AddHttpClient<IGeocodingService, GeocodingService>(client =>
{
    client.BaseAddress = new Uri(builder.Configuration["OpenMeteo:GeocodingBaseUrl"] ?? "https://geocoding-api.open-meteo.com/");
    client.Timeout = TimeSpan.FromSeconds(10);
});

// A Vite fejlesztői szerver (React) külön porton fut.
builder.Services.AddCors(o => o.AddPolicy("frontend", p => p
    .WithOrigins(builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? ["http://localhost:5173"])
    .AllowAnyHeader()
    .AllowAnyMethod()));

var app = builder.Build();

app.UseExceptionHandler();
app.UseStatusCodePages();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors("frontend");

// A lebuildelt React alkalmazás (npm run build → wwwroot) kiszolgálása.
app.UseDefaultFiles();
app.UseStaticFiles();

app.MapControllers();
app.MapFallbackToFile("index.html");

app.Run();
