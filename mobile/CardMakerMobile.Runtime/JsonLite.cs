using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;

namespace CardMakerMobile.Runtime
{
    internal static class JsonLite
    {
        public static string ReadStringField(string json, string key)
        {
            var match = Regex.Match(
                json,
                "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"((?:\\\\.|[^\"])*)\"",
                RegexOptions.CultureInvariant);
            if (!match.Success)
            {
                return null;
            }
            return Unescape(match.Groups[1].Value);
        }

        public static long? ReadLongField(string json, string key)
        {
            var match = Regex.Match(
                json,
                "\"" + Regex.Escape(key) + "\"\\s*:\\s*(\\d+)",
                RegexOptions.CultureInvariant);
            if (!match.Success)
            {
                return null;
            }
            return long.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture);
        }

        public static IEnumerable<string> ReadObjectsFromArray(string json, string arrayKey)
        {
            var keyMatch = Regex.Match(
                json,
                "\"" + Regex.Escape(arrayKey) + "\"\\s*:\\s*\\[",
                RegexOptions.CultureInvariant);
            if (!keyMatch.Success)
            {
                yield break;
            }

            var index = keyMatch.Index + keyMatch.Length;
            var depth = 0;
            var objectStart = -1;
            var inString = false;
            var escaped = false;

            for (; index < json.Length; index++)
            {
                var ch = json[index];
                if (inString)
                {
                    if (escaped)
                    {
                        escaped = false;
                    }
                    else if (ch == '\\')
                    {
                        escaped = true;
                    }
                    else if (ch == '"')
                    {
                        inString = false;
                    }
                    continue;
                }

                if (ch == '"')
                {
                    inString = true;
                    continue;
                }
                if (ch == '{')
                {
                    if (depth == 0)
                    {
                        objectStart = index;
                    }
                    depth++;
                    continue;
                }
                if (ch == '}')
                {
                    depth--;
                    if (depth == 0 && objectStart >= 0)
                    {
                        yield return json.Substring(objectStart, index - objectStart + 1);
                        objectStart = -1;
                    }
                    continue;
                }
                if (ch == ']' && depth == 0)
                {
                    yield break;
                }
            }
        }

        public static Dictionary<string, string> ReadStringMapField(string json, string key)
        {
            var result = new Dictionary<string, string>();
            var keyMatch = Regex.Match(
                json,
                "\"" + Regex.Escape(key) + "\"\\s*:\\s*\\{",
                RegexOptions.CultureInvariant);
            if (!keyMatch.Success)
            {
                return result;
            }

            var start = keyMatch.Index + keyMatch.Length;
            var end = FindMatchingObjectEnd(json, start - 1);
            if (end <= start)
            {
                return result;
            }

            var body = json.Substring(start, end - start);
            var matches = Regex.Matches(
                body,
                "\"((?:\\\\.|[^\"])*)\"\\s*:\\s*\"((?:\\\\.|[^\"])*)\"",
                RegexOptions.CultureInvariant);
            foreach (Match match in matches)
            {
                result[Unescape(match.Groups[1].Value)] = Unescape(match.Groups[2].Value);
            }
            return result;
        }

        public static string EscapeString(string value)
        {
            if (value == null)
            {
                return "";
            }
            var output = new System.Text.StringBuilder(value.Length + 8);
            for (var i = 0; i < value.Length; i++)
            {
                var ch = value[i];
                switch (ch)
                {
                    case '"':
                        output.Append("\\\"");
                        break;
                    case '\\':
                        output.Append("\\\\");
                        break;
                    case '\b':
                        output.Append("\\b");
                        break;
                    case '\f':
                        output.Append("\\f");
                        break;
                    case '\n':
                        output.Append("\\n");
                        break;
                    case '\r':
                        output.Append("\\r");
                        break;
                    case '\t':
                        output.Append("\\t");
                        break;
                    default:
                        if (ch < 32)
                        {
                            output.Append("\\u");
                            output.Append(((int)ch).ToString("x4", CultureInfo.InvariantCulture));
                        }
                        else
                        {
                            output.Append(ch);
                        }
                        break;
                }
            }
            return output.ToString();
        }

        private static int FindMatchingObjectEnd(string json, int objectStart)
        {
            var depth = 0;
            var inString = false;
            var escaped = false;
            for (var i = objectStart; i < json.Length; i++)
            {
                var ch = json[i];
                if (inString)
                {
                    if (escaped)
                    {
                        escaped = false;
                    }
                    else if (ch == '\\')
                    {
                        escaped = true;
                    }
                    else if (ch == '"')
                    {
                        inString = false;
                    }
                    continue;
                }

                if (ch == '"')
                {
                    inString = true;
                }
                else if (ch == '{')
                {
                    depth++;
                }
                else if (ch == '}')
                {
                    depth--;
                    if (depth == 0)
                    {
                        return i;
                    }
                }
            }
            return -1;
        }

        private static string Unescape(string value)
        {
            var output = new System.Text.StringBuilder(value.Length);
            for (var i = 0; i < value.Length; i++)
            {
                var ch = value[i];
                if (ch != '\\' || i + 1 >= value.Length)
                {
                    output.Append(ch);
                    continue;
                }

                var next = value[++i];
                switch (next)
                {
                    case '"':
                    case '\\':
                    case '/':
                        output.Append(next);
                        break;
                    case 'b':
                        output.Append('\b');
                        break;
                    case 'f':
                        output.Append('\f');
                        break;
                    case 'n':
                        output.Append('\n');
                        break;
                    case 'r':
                        output.Append('\r');
                        break;
                    case 't':
                        output.Append('\t');
                        break;
                    case 'u':
                        if (i + 4 >= value.Length)
                        {
                            throw new FormatException("Invalid JSON unicode escape.");
                        }
                        var hex = value.Substring(i + 1, 4);
                        output.Append((char)int.Parse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                        i += 4;
                        break;
                    default:
                        output.Append(next);
                        break;
                }
            }
            return output.ToString();
        }
    }
}
