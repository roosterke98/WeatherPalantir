using System.Globalization;

namespace WeatherPalantir.Logic;

/// <summary>
/// Minimális WKT → GeoJSON átalakító a SQL Server geography típus STAsText() kimenetéhez
/// (POLYGON, MULTIPOLYGON, GEOMETRYCOLLECTION). A geography a koordinátákat „hosszúság szélesség” sorrendben adja,
/// ami megegyezik a GeoJSON sorrendjével.
/// <para>
/// A SQL Server geography a külső gyűrűket az óramutatóval ellentétesen tárolja („bal kéz szabály”),
/// a D3.js gömbi geometriája viszont az óramutató járásával megegyező külső gyűrűt vár,
/// ezért minden gyűrű sorrendje megfordításra kerül.
/// </para>
/// </summary>
public static class WktGeoJson
{
    /// <summary>Visszaadja a WKT-ben szereplő poligonokat GeoJSON MultiPolygon koordinátaként: [poligon][gyűrű][pont][x,y].</summary>
    public static List<List<List<double[]>>> ToMultiPolygon(string wkt)
    {
        var reader = new Reader(wkt);
        var polygons = new List<List<List<double[]>>>();
        ReadGeometry(reader, polygons);
        return polygons;
    }

    private static void ReadGeometry(Reader r, List<List<List<double[]>>> polygons)
    {
        var type = r.ReadWord().ToUpperInvariant();
        if (r.TryReadWord("EMPTY")) return;

        switch (type)
        {
            case "POLYGON":
                polygons.Add(ReadPolygon(r));
                break;
            case "MULTIPOLYGON":
                r.Expect('(');
                do { polygons.Add(ReadPolygon(r)); } while (r.TryRead(','));
                r.Expect(')');
                break;
            case "GEOMETRYCOLLECTION":
                r.Expect('(');
                do { ReadGeometry(r, polygons); } while (r.TryRead(','));
                r.Expect(')');
                break;
            default:
                // Pont / vonal elemeket (pl. egyszerűsítés melléktermékei) a térkép szempontjából figyelmen kívül hagyunk.
                SkipBalanced(r);
                break;
        }
    }

    private static List<List<double[]>> ReadPolygon(Reader r)
    {
        var rings = new List<List<double[]>>();
        r.Expect('(');
        do
        {
            var ring = new List<double[]>();
            r.Expect('(');
            do
            {
                var x = r.ReadNumber();
                var y = r.ReadNumber();
                while (r.PeekIsNumber()) r.ReadNumber(); // Z / M értékek kihagyása
                ring.Add([Math.Round(x, 5), Math.Round(y, 5)]);
            } while (r.TryRead(','));
            r.Expect(')');
            ring.Reverse();
            rings.Add(ring);
        } while (r.TryRead(','));
        r.Expect(')');
        return rings;
    }

    private static void SkipBalanced(Reader r)
    {
        var depth = 0;
        do
        {
            var c = r.Next();
            if (c == '(') depth++;
            else if (c == ')') depth--;
        } while (depth > 0 && !r.End);
    }

    private sealed class Reader(string text)
    {
        private int _pos;
        public bool End => _pos >= text.Length;

        private void SkipWs() { while (_pos < text.Length && char.IsWhiteSpace(text[_pos])) _pos++; }

        public char Next() { SkipWs(); return text[_pos++]; }

        public string ReadWord()
        {
            SkipWs();
            var start = _pos;
            while (_pos < text.Length && char.IsLetter(text[_pos])) _pos++;
            return text[start.._pos];
        }

        public bool TryReadWord(string word)
        {
            SkipWs();
            if (string.Compare(text, _pos, word, 0, word.Length, StringComparison.OrdinalIgnoreCase) != 0) return false;
            _pos += word.Length;
            return true;
        }

        public void Expect(char c)
        {
            SkipWs();
            if (_pos >= text.Length || text[_pos] != c)
                throw new FormatException($"Hibás WKT: '{c}' várt a(z) {_pos}. pozíción.");
            _pos++;
        }

        public bool TryRead(char c)
        {
            SkipWs();
            if (_pos < text.Length && text[_pos] == c) { _pos++; return true; }
            return false;
        }

        public bool PeekIsNumber()
        {
            SkipWs();
            return _pos < text.Length && (char.IsDigit(text[_pos]) || text[_pos] is '-' or '+' or '.');
        }

        public double ReadNumber()
        {
            SkipWs();
            var start = _pos;
            while (_pos < text.Length && (char.IsDigit(text[_pos]) || text[_pos] is '-' or '+' or '.' or 'e' or 'E')) _pos++;
            return double.Parse(text.AsSpan(start, _pos - start), NumberStyles.Float, CultureInfo.InvariantCulture);
        }
    }
}
