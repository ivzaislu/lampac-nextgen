using System;
using System.Globalization;
using System.Text;

namespace Cinemar;

internal static class PlayerFileDecoder
{
    static readonly UTF8Encoding utf8 = new UTF8Encoding(false, true);

    // Native equivalent of Kinogo's playerjs.js string decoder.
    internal static string Decode(string input)
    {
        if (string.IsNullOrEmpty(input) || !input.StartsWith("#2", StringComparison.Ordinal) || input.Length < 4)
            return null;

        try
        {
            string delimiterText = input.Substring(2, 2);
            double delimiterValue = 0;
            if (double.TryParse(delimiterText, NumberStyles.Float, CultureInfo.InvariantCulture, out double value)
                && double.IsFinite(value))
            {
                delimiterValue = Math.Truncate(value) % 65536;
                if (delimiterValue < 0)
                    delimiterValue += 65536;
            }

            char delimiter = (char)delimiterValue;
            var encoded = new StringBuilder(input.Length);
            foreach (string part in input.Substring(4).Split(delimiter))
            {
                if (part.Length <= 32)
                {
                    encoded.Append(part);
                    continue;
                }

                char digit = part[part.Length - 1];
                // JS parseInt of a non-digit yields NaN; both substr calls then return empty.
                if (digit < '0' || digit > '9')
                    continue;

                int t = digit - '0';
                encoded.Append(part, 2 * t, part.Length - 3 * t - 1);
                encoded.Append(part, 0, t);
            }

            int padding = encoded.Length % 4;
            if (padding != 0)
                encoded.Append('=', 4 - padding);

            // atob accepts ASCII whitespace, including form feed.
            string base64 = encoded.ToString().Replace("\f", string.Empty);
            byte[] bytes = Convert.FromBase64String(base64);

            // JS escape(atob(...)) followed by decodeURIComponent decodes UTF-8.
            // The existing playlist deserializer validates and parses the JSON.
            return utf8.GetString(bytes);
        }
        catch (FormatException)
        {
            return null;
        }
        catch (DecoderFallbackException)
        {
            return null;
        }
    }
}
