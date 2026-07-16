using System.Collections.Generic;
using System.IO;

namespace CardMakerMobile.Runtime
{
    public sealed class MobileCardShardInfo
    {
        public string Key { get; set; }
        public string Game { get; set; }
        public string Href { get; set; }
        public int CardCount { get; set; }
    }

    public sealed class MobileCardsIndex
    {
        public MobileCardsIndex()
        {
            Shards = new List<MobileCardShardInfo>();
        }

        public int TotalCards { get; private set; }
        public List<MobileCardShardInfo> Shards { get; private set; }

        public static MobileCardsIndex Load(string indexPath)
        {
            var json = File.ReadAllText(indexPath);
            var index = new MobileCardsIndex();
            var total = JsonLite.ReadLongField(json, "totalCards");
            index.TotalCards = total.HasValue ? (int)total.Value : 0;

            foreach (var shardJson in JsonLite.ReadObjectsFromArray(json, "shards"))
            {
                var href = JsonLite.ReadStringField(shardJson, "href");
                if (string.IsNullOrEmpty(href))
                {
                    continue;
                }
                var count = JsonLite.ReadLongField(shardJson, "cardCount");
                index.Shards.Add(new MobileCardShardInfo
                {
                    Key = JsonLite.ReadStringField(shardJson, "key"),
                    Game = JsonLite.ReadStringField(shardJson, "game"),
                    Href = ArchivePath.Normalize(href),
                    CardCount = count.HasValue ? (int)count.Value : 0
                });
            }
            return index;
        }
    }
}
