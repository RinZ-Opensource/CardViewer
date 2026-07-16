using System.Collections.Generic;
using System.IO;

namespace CardMakerMobile.Runtime
{
    public sealed class MobileCardCatalog
    {
        public MobileCardCatalog()
        {
            Cards = new List<MobileCardRecord>();
        }

        public List<MobileCardRecord> Cards { get; private set; }

        public IEnumerable<MobileCardRecord> CardsForGame(string game)
        {
            for (var i = 0; i < Cards.Count; i++)
            {
                if (Cards[i].Game == game)
                {
                    yield return Cards[i];
                }
            }
        }

        public int CountForGame(string game)
        {
            var count = 0;
            for (var i = 0; i < Cards.Count; i++)
            {
                if (Cards[i].Game == game)
                {
                    count++;
                }
            }
            return count;
        }

        public static MobileCardCatalog LoadShards(string installRoot, MobileCardsIndex index)
        {
            var catalog = new MobileCardCatalog();
            for (var i = 0; i < index.Shards.Count; i++)
            {
                var shardPath = ArchivePath.ToSafeFilePath(installRoot, index.Shards[i].Href);
                var json = File.ReadAllText(shardPath);
                foreach (var cardJson in JsonLite.ReadObjectsFromArray(json, "cards"))
                {
                    catalog.Cards.Add(MobileCardRecord.Parse(cardJson));
                }
            }
            return catalog;
        }
    }
}
