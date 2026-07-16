using System.Collections.Generic;
using System.IO;
using System.Text;

namespace CardMakerMobile.Runtime
{
    public sealed class MobileEditSession
    {
        private readonly Dictionary<string, MobileCardEdits> editsByKey = new Dictionary<string, MobileCardEdits>();

        public IEnumerable<MobileCardEdits> Edits
        {
            get { return editsByKey.Values; }
        }

        public int Count
        {
            get { return editsByKey.Count; }
        }

        public static string CardKey(string game, string id)
        {
            return (game ?? "") + ":" + (id ?? "");
        }

        public void SetPrintField(MobileCardRecord card, string fieldKey, string value)
        {
            var edits = GetOrCreate(card);
            edits.PrintFields[fieldKey] = value ?? "";
        }

        public MobileCardRecord Apply(MobileCardRecord card)
        {
            MobileCardEdits edits;
            return editsByKey.TryGetValue(CardKey(card.Game, card.Id), out edits) ? edits.ApplyTo(card) : card.Clone();
        }

        public void Save(string path)
        {
            var dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir))
            {
                Directory.CreateDirectory(dir);
            }
            File.WriteAllText(path, ToJson(), Encoding.UTF8);
        }

        public static MobileEditSession Load(string path)
        {
            var session = new MobileEditSession();
            if (!File.Exists(path))
            {
                return session;
            }

            var json = File.ReadAllText(path, Encoding.UTF8);
            foreach (var editJson in JsonLite.ReadObjectsFromArray(json, "cards"))
            {
                var edits = new MobileCardEdits
                {
                    Game = JsonLite.ReadStringField(editJson, "game"),
                    Id = JsonLite.ReadStringField(editJson, "id"),
                    DataName = JsonLite.ReadStringField(editJson, "dataName")
                };
                foreach (var item in JsonLite.ReadStringMapField(editJson, "printFields"))
                {
                    edits.PrintFields[item.Key] = item.Value;
                }
                if (!string.IsNullOrEmpty(edits.Game) && !string.IsNullOrEmpty(edits.Id))
                {
                    session.editsByKey[edits.Key] = edits;
                }
            }
            return session;
        }

        private MobileCardEdits GetOrCreate(MobileCardRecord card)
        {
            var key = CardKey(card.Game, card.Id);
            MobileCardEdits edits;
            if (!editsByKey.TryGetValue(key, out edits))
            {
                edits = new MobileCardEdits
                {
                    Game = card.Game,
                    Id = card.Id,
                    DataName = card.DataName
                };
                editsByKey[key] = edits;
            }
            return edits;
        }

        private string ToJson()
        {
            var builder = new StringBuilder();
            builder.Append("{\n  \"schemaVersion\": 1,\n  \"cards\": [");
            var firstCard = true;
            foreach (var edits in editsByKey.Values)
            {
                if (!firstCard)
                {
                    builder.Append(",");
                }
                firstCard = false;
                builder.Append("\n    {\n");
                AppendStringField(builder, "key", edits.Key, true, 6);
                AppendStringField(builder, "game", edits.Game, true, 6);
                AppendStringField(builder, "id", edits.Id, true, 6);
                AppendStringField(builder, "dataName", edits.DataName, true, 6);
                builder.Append("      \"printFields\": {");
                var firstField = true;
                foreach (var field in edits.PrintFields)
                {
                    if (!firstField)
                    {
                        builder.Append(",");
                    }
                    firstField = false;
                    builder.Append("\n        \"");
                    builder.Append(JsonLite.EscapeString(field.Key));
                    builder.Append("\": \"");
                    builder.Append(JsonLite.EscapeString(field.Value));
                    builder.Append("\"");
                }
                if (!firstField)
                {
                    builder.Append("\n      ");
                }
                builder.Append("}\n    }");
            }
            if (!firstCard)
            {
                builder.Append("\n  ");
            }
            builder.Append("]\n}\n");
            return builder.ToString();
        }

        private static void AppendStringField(StringBuilder builder, string key, string value, bool comma, int indent)
        {
            builder.Append(new string(' ', indent));
            builder.Append("\"");
            builder.Append(JsonLite.EscapeString(key));
            builder.Append("\": \"");
            builder.Append(JsonLite.EscapeString(value));
            builder.Append("\"");
            if (comma)
            {
                builder.Append(",");
            }
            builder.Append("\n");
        }
    }
}
